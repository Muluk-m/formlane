"""Deterministic delivery stages with native CrewAI and granular DBOS replay."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import time
import uuid
from concurrent.futures import CancelledError
from types import MappingProxyType
from typing import Any, Callable, Literal

# Set before importing CrewAI; neither prompts nor provider credentials leave via telemetry.
os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CREWAI_TRACING_ENABLED"] = "false"

from crewai import Agent, Crew, Process, Task
from crewai.agents.agent_executor import AgentExecutor
from crewai.flow.flow_definition import FlowDefinition
from crewai.tools.base_tool import Tool
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .compiler import compile_project
from .model_stream import ObservedOpenAI, RuntimeAbort
from .project import artifact_hash, create_source, is_project_path, source_hash, validate_source
from .prompts import (
    ITERATION_INSTRUCTIONS,
    ROLE_GOALS,
    ROLE_INSTRUCTIONS,
    TEAM_INSTRUCTIONS,
)
from .validator import validate_artifact, validate_checks


class HarnessFailure(BaseException):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class NoArgs(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class PathArgs(NoArgs):
    path: str

    @field_validator("path")
    @classmethod
    def safe_path(cls, value: str) -> str:
        if not is_project_path(value):
            raise ValueError("Use a safe relative project file path.")
        return value


class WriteArgs(PathArgs):
    content: str = Field(max_length=180_000)


class Edit(NoArgs):
    find: str = Field(min_length=1, max_length=180_000)
    replacement: str = Field(max_length=180_000)


class EditArgs(PathArgs):
    edits: list[Edit] = Field(min_length=1, max_length=8)


class InitializeArgs(NoArgs):
    template: Literal["vanilla", "react-ts"]
    reason: str = Field(min_length=1, max_length=2000)


class ReviewFilesArgs(NoArgs):
    paths: list[str] = Field(min_length=1, max_length=128)

    @field_validator("paths")
    @classmethod
    def safe_paths(cls, value: list[str]) -> list[str]:
        if not all(is_project_path(path) for path in value):
            raise ValueError("Use safe relative project file paths.")
        return value


class BrowserAction(NoArgs):
    kind: Literal["click", "fill", "select", "press", "reload"]
    selector: str = Field(min_length=1, max_length=300)
    value: str | None

    @model_validator(mode="after")
    def select_value(self):
        if self.kind == "select" and self.value is None:
            raise ValueError("Select requires the option's string value.")
        return self


class BrowserAssertion(NoArgs):
    kind: Literal["text", "value", "count", "attribute", "no-horizontal-overflow"]
    selector: str = Field(min_length=1, max_length=300)
    expected: str = Field(max_length=1000)
    attribute: str | None = None


class Viewport(NoArgs):
    width: int = Field(ge=375, le=1440)
    height: int = Field(ge=640, le=1200)


class BrowserCheck(NoArgs):
    name: str = Field(min_length=1, max_length=160)
    viewport: Viewport | None = None
    actions: list[BrowserAction] = Field(max_length=16)
    assertion: BrowserAssertion | None = None
    assertions: list[BrowserAssertion] = Field(default_factory=list, max_length=12)


Capability = Literal[
    "frontend",
    "memory",
    "durable_storage",
    "shared_storage",
    "browser_storage",
    "network",
    "server",
    "auth",
]
CAPABILITIES = {
    "revision": "opaque-offline-v1",
    "supported": ["frontend", "memory"],
    "unavailable": [
        "durable_storage",
        "shared_storage",
        "browser_storage",
        "network",
        "server",
        "auth",
    ],
}
MAX_REPAIRS = 2


class RequirementEvidence(NoArgs):
    origin: Literal["request", "baseline"]
    path: str | None
    quote: str = Field(min_length=1, max_length=3000)
    explanation: str = Field(min_length=1, max_length=2000)


class Requirement(NoArgs):
    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    description: str = Field(min_length=1, max_length=2000)
    acceptance: str = Field(min_length=1, max_length=2000)
    capabilities: list[Capability] = Field(min_length=1, max_length=8)
    evidence: list[RequirementEvidence] = Field(min_length=1, max_length=8)


class ContractArgs(NoArgs):
    brief: str = Field(min_length=1, max_length=6000)
    assumptions: list[str] = Field(max_length=16)
    requirements: list[Requirement] = Field(min_length=1, max_length=16)


class RequirementCheck(BrowserCheck):
    requirementIds: list[str] = Field(min_length=1, max_length=16)


class ChecksArgs(NoArgs):
    checks: list[RequirementCheck] = Field(min_length=2, max_length=16)


class CandidateArgs(NoArgs):
    summary: str = Field(min_length=1, max_length=6000)


class Assessment(NoArgs):
    requirementId: str = Field(min_length=1, max_length=40)
    passed: bool
    evidence: str = Field(min_length=1, max_length=3000)


class Finding(NoArgs):
    requirementId: str = Field(min_length=1, max_length=40)
    observation: str = Field(min_length=1, max_length=2000)
    correction: str = Field(min_length=1, max_length=2000)


class ReviewArgs(NoArgs):
    accepted: bool
    summary: str = Field(min_length=1, max_length=6000)
    assessments: list[Assessment] = Field(min_length=1, max_length=16)
    findings: list[Finding] = Field(max_length=16)


def apply_file_edits(content: str, edits: list[dict | Edit]) -> str:
    candidate = content
    for raw in edits:
        edit = raw if isinstance(raw, Edit) else Edit.model_validate(raw)
        if candidate.count(edit.find) != 1:
            raise ValueError("Edit target must match exactly once. Read the current file.")
        if edit.find == edit.replacement:
            raise ValueError("Edit replacement must change the file.")
        candidate = candidate.replace(edit.find, edit.replacement, 1)
    if len(candidate.encode("utf-16-le")) // 2 > 180_000:
        raise ValueError("File exceeds the character limit.")
    return candidate


def checks_hash(checks: Any) -> str:
    return hashlib.sha256(
        json.dumps(checks, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def current_build(workspace: dict) -> dict | None:
    build = workspace["build"]
    if not workspace["source"] or not build or not workspace["html"]:
        return None
    if (
        build["revision"] != workspace["revision"]
        or build["sourceHash"] != source_hash(workspace["source"])
        or build["artifactHash"] != artifact_hash(workspace["html"])
    ):
        return None
    return build


def completion_status(workspace: dict) -> dict:
    build = current_build(workspace)
    contract = workspace["contract"]
    missing = []
    if not contract or contract["blockers"]:
        missing.append("capability_contract")
    if not build:
        missing.append("current_build")
    identity = {
        "sourceHash": build["sourceHash"] if build else None,
        "artifactHash": build["artifactHash"] if build else None,
        "contractHash": contract["hash"] if contract else None,
    }
    for key, checks_key in (
        ("implementationValidation", "checks"),
        ("independentValidation", "reviewChecks"),
    ):
        evidence = workspace[key]
        if (
            not build
            or not evidence
            or not evidence.get("valid")
            or any(evidence.get(k) != v for k, v in identity.items())
            or evidence.get("checksHash") != checks_hash(workspace[checks_key])
        ):
            missing.append(key)
    review = workspace["review"]
    if (
        not build
        or not review
        or not review.get("accepted")
        or any(review.get(k) != v for k, v in identity.items())
        or review.get("checksHash") != checks_hash(workspace["reviewChecks"])
        or not workspace["independentValidation"]
        or review.get("reviewerScope") != workspace["independentValidation"].get("scope")
        or (
            workspace["implementationValidation"]
            and review.get("reviewerScope") == workspace["implementationValidation"].get("scope")
        )
    ):
        missing.append("independent_review")
    return {"ready": not missing, "missing": missing}


def source_changes(source: dict | None, previous: Any) -> list[dict]:
    files = source["files"] if source else {}
    baseline = previous["files"] if previous else {}
    return [
        {
            "path": path,
            "status": "deleted"
            if path not in files
            else "added"
            if path not in baseline
            else "unchanged"
            if files[path] == baseline[path]
            else "modified",
        }
        for path in sorted(files.keys() | baseline.keys())
    ]


CHECK_INSTRUCTIONS = """Use 2–8 meaningful browser checks, at most 12 actions and 8 assertions per check.
Each starts in a fresh isolated page; optional viewport is width 375–1440, height 640–1200.
Example: {"name":"increment", "actions":[{"kind":"click","selector":"button","value":null}],
"assertions":[{"kind":"text","selector":"output","expected":"2","attribute":null}]}.
Actions: click, fill (input/textarea text, string value), select (native <select>, string option value), press (Enter/Tab/Escape/ArrowUp/ArrowDown/ArrowLeft/ArrowRight/Space/Backspace/Delete/Home/End), reload (body, null).
Use select for a native dropdown, with the option's value (not its label). Never fill a <select>.
Assertions: text containment; value/count/attribute exact equality; no-horizontal-overflow (body, expected "true").
Expected is a string. Boolean attributes use selector counts on :disabled/:enabled. Quote CSS attribute values.
Commit filled controls by moving focus before keyboard assertions. Reload resets in-memory state.
Combine related assertions; verify calculations and correct wrong expectations without changing valid app behavior.
"""


class Runtime:
    def __init__(
        self, settings: Any, context: dict, durable: Any, emit: Callable, cancelled: Callable
    ):
        self.settings, self.context = settings, copy.deepcopy(context)
        self.durable, self.emit, self.cancelled = durable, emit, cancelled
        previous = copy.deepcopy(context.get("previousSource"))
        if previous:
            validate_source(previous)
        self.previous = (
            MappingProxyType(
                {"template": previous["template"], "files": MappingProxyType(previous["files"])}
            )
            if previous
            else None
        )
        self.workspace = {
            "contract": None,
            "source": copy.deepcopy(previous),
            "html": "",
            "build": None,
            "checks": [],
            "reviewChecks": [],
            "report": None,
            "implementationValidation": None,
            "independentValidation": None,
            "review": None,
            "revision": 0,
            "reviewedPaths": [],
            "candidateSummary": None,
        }
        self.scope = self.new_scope("flow-v2/controller", "controller")
        self.model_factory: Callable | None = None

    def new_scope(self, path: str, role: str) -> dict:
        return {
            "path": path,
            "role": role,
            "message_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{self.context['runId']}:{path}")),
            "llm_index": 0,
            "tool_index": 0,
        }

    def begin_model_call(self, scope: dict) -> None:
        # Native agents have a stage-local iteration bound. Replaying provider
        # results does not spend another global delegation allowance.
        self.check()

    def check(self) -> None:
        if self.cancelled():
            raise CancelledError()

    def clear_evidence(self) -> None:
        self.workspace.update(
            html="",
            build=None,
            report=None,
            implementationValidation=None,
            independentValidation=None,
            review=None,
            reviewedPaths=[],
            reviewChecks=[],
            candidateSummary=None,
        )

    def invalidate(self, source: dict) -> None:
        validate_source(source)
        if source == self.workspace["source"]:
            raise ValueError("Source is unchanged. Use concrete diagnostics to make progress.")
        self.workspace["source"] = source
        self.workspace["revision"] += 1
        self.clear_evidence()

    def workspace_info(self) -> dict:
        current = self.workspace
        source = current["source"]
        return {
            **{key: value for key, value in current.items() if key not in ("source", "html")},
            "template": source["template"] if source else None,
            "files": [
                {"path": path, "characters": len(content)}
                for path, content in sorted((source or {}).get("files", {}).items())
            ],
            "previousFiles": sorted(self.previous["files"]) if self.previous else [],
            "sourceChanges": source_changes(source, self.previous),
            "userRequest": self.context.get("request", ""),
            "capabilities": copy.deepcopy(CAPABILITIES),
            "completion": completion_status(current),
        }

    def freeze_contract(self, args: dict) -> dict:
        if self.workspace["contract"] is not None:
            raise ValueError("Requirements are frozen; review and repair cannot replace them.")
        contract = ContractArgs.model_validate(args).model_dump()
        ids = [item["id"] for item in contract["requirements"]]
        if len(ids) != len(set(ids)):
            raise ValueError("Requirement identifiers must be unique.")
        blockers = []
        for requirement in contract["requirements"]:
            for evidence in requirement["evidence"]:
                if evidence["origin"] == "request":
                    text = self.context["request"] if evidence["path"] is None else ""
                else:
                    text = self.previous["files"].get(evidence["path"], "") if self.previous else ""
                if evidence["quote"] not in text:
                    raise ValueError(
                        "Requirement evidence must quote the exact request or immutable baseline."
                    )
            unavailable = sorted(
                set(requirement["capabilities"]) & set(CAPABILITIES["unavailable"])
            )
            if unavailable:
                blockers.append(
                    {
                        "requirementId": requirement["id"],
                        "capabilities": unavailable,
                        "evidence": requirement["evidence"],
                    }
                )
        contract.update(
            request=self.context["request"],
            baselineHash=source_hash(self.context["previousSource"]) if self.previous else None,
            capabilities=copy.deepcopy(CAPABILITIES),
            blockers=blockers,
        )
        contract["hash"] = checks_hash(contract)
        self.workspace["contract"] = contract
        return copy.deepcopy(contract)

    def required_ids(self) -> set[str]:
        contract = self.workspace["contract"]
        if not contract:
            raise ValueError("Analyze and freeze requirements first.")
        blocked = {item["requirementId"] for item in contract["blockers"]}
        return {item["id"] for item in contract["requirements"]} - blocked

    def check_plan(self, checks: list[dict]) -> list[dict]:
        required = self.required_ids()
        parsed = ChecksArgs.model_validate({"checks": checks}).model_dump()["checks"]
        coverage = {identifier for check in parsed for identifier in check["requirementIds"]}
        if coverage != required:
            raise ValueError(
                "Checks must cover every supported frozen requirement using only its identifiers."
            )
        normalized = validate_checks(parsed)
        if len({check["name"] for check in normalized}) != len(normalized):
            raise ValueError("Check names must be unique.")
        return [
            {**check, "requirementIds": original["requirementIds"]}
            for check, original in zip(normalized, parsed, strict=True)
        ]

    def identity(self) -> dict:
        built = current_build(self.workspace)
        if not built or not self.workspace["contract"]:
            raise ValueError("A compiled current candidate and frozen contract are required.")
        return {
            "sourceHash": built["sourceHash"],
            "artifactHash": built["artifactHash"],
            "contractHash": self.workspace["contract"]["hash"],
        }

    def operation(self, name: str, args: dict) -> dict:
        self.check()
        current, role = self.workspace, self.scope["role"]
        source = current["source"]
        permissions = {
            "submit_contract": "emma",
            "initialize_project": "alex",
            "write_file": "alex",
            "edit_file": "alex",
            "delete_file": "alex",
            "set_acceptance_checks": "alex",
            "finish_candidate": "alex",
            "read_review_files": "david",
            "set_review_checks": "david",
            "record_review": "david",
            "validate_preview": "david",
            "build_project": "controller",
            "validate_implementation": "controller",
        }
        if name in permissions and role != permissions[name]:
            raise ValueError("This stage cannot perform that operation.")
        if name == "read_workspace":
            return self.workspace_info()
        if name == "read_previous_file":
            if not self.previous or args["path"] not in self.previous["files"]:
                raise ValueError("File does not exist in the saved baseline.")
            return {"path": args["path"], "content": self.previous["files"][args["path"]]}
        if name == "submit_contract":
            return self.freeze_contract(args)
        if name == "read_review_files":
            files = (source or {}).get("files", {})
            baseline = self.previous["files"] if self.previous else {}
            statuses = {
                item["path"]: item["status"] for item in source_changes(source, self.previous)
            }
            paths = list(dict.fromkeys(args["paths"]))
            current["reviewedPaths"] = sorted(
                set(current["reviewedPaths"]) | (set(paths) & statuses.keys())
            )
            return {
                "identity": self.identity(),
                "files": [
                    {
                        "path": path,
                        "status": statuses.get(path, "missing"),
                        "current": files.get(path),
                        "previous": baseline.get(path),
                    }
                    for path in paths
                ],
            }
        if name == "initialize_project":
            if source:
                raise ValueError("Project already exists. Preserve its template and edit files.")
            self.invalidate(create_source(args["template"]))
            self.emit(
                "project_initialized", {"source": current["source"], "reason": args["reason"]}
            )
            return {
                "template": args["template"],
                "revision": current["revision"],
                "files": sorted(current["source"]["files"]),
            }
        if name in ("set_acceptance_checks", "set_review_checks"):
            checks = self.check_plan(args["checks"])
            if name == "set_acceptance_checks":
                current.update(checks=checks, implementationValidation=None, candidateSummary=None)
            else:
                current.update(reviewChecks=checks)
            current.update(independentValidation=None, review=None, report=None)
            return {"checks": len(checks), "contractHash": current["contract"]["hash"]}
        if name == "finish_candidate":
            if not source:
                raise ValueError("Produce coherent source before finishing implementation.")
            validate_source(source)
            if self.required_ids():
                self.check_plan(current["checks"])
            current["candidateSummary"] = args["summary"]
            return {
                "sourceHash": source_hash(source),
                "summary": args["summary"],
                "accepted": False,
            }
        if name == "record_review":
            identity = self.identity()
            required = self.required_ids()
            assessments = args["assessments"]
            if {item["requirementId"] for item in assessments} != required or len(
                assessments
            ) != len(required):
                raise ValueError("Assess every frozen requirement exactly once.")
            findings = args["findings"]
            if any(item["requirementId"] not in required for item in findings):
                raise ValueError("Review findings must identify a frozen requirement.")
            if not args["accepted"] and not findings:
                raise ValueError("A rejection requires concrete requirement-linked findings.")
            evidence = current["independentValidation"]
            inspected = {item["path"] for item in source_changes(source, self.previous)}
            if args["accepted"] and (
                findings
                or not all(item["passed"] for item in assessments)
                or current["contract"]["blockers"]
                or not inspected.issubset(current["reviewedPaths"])
                or not evidence
                or not evidence["valid"]
                or evidence["scope"] != self.scope["path"]
                or evidence["checksHash"] != checks_hash(current["reviewChecks"])
                or any(evidence.get(key) != value for key, value in identity.items())
            ):
                raise ValueError(
                    "Acceptance requires substantive source/baseline inspection and independent current-artifact evidence for every frozen requirement."
                )
            current["review"] = {
                **copy.deepcopy(args),
                **identity,
                "checksHash": checks_hash(current["reviewChecks"]),
                "reviewerScope": self.scope["path"],
            }
            return {**current["review"], "completion": completion_status(current)}
        if not source:
            raise ValueError("Initialize a project before working with files.")
        if name == "read_file":
            if args["path"] not in source["files"]:
                raise ValueError("File does not exist.")
            return {"path": args["path"], "content": source["files"][args["path"]]}
        if name in ("write_file", "edit_file", "delete_file"):
            candidate = {"template": source["template"], "files": dict(source["files"])}
            path = args["path"]
            if name in ("edit_file", "delete_file") and path not in candidate["files"]:
                raise ValueError("File does not exist. Read workspace first.")
            if name == "delete_file":
                del candidate["files"][path]
            else:
                candidate["files"][path] = (
                    args["content"]
                    if name == "write_file"
                    else apply_file_edits(candidate["files"][path], args["edits"])
                )
            self.invalidate(candidate)
            return {
                "path": path,
                "revision": current["revision"],
                "message": "Source changed. Current-source validation and independent review are required.",
            }
        if name == "build_project":
            summary = current["candidateSummary"]
            self.clear_evidence()
            current["candidateSummary"] = summary
            result = compile_project(source, self.settings, self.cancelled)
            self.check()
            digest = source_hash(source)
            if result["sourceHash"] != digest:
                raise ValueError("Compiler output does not match current source.")
            current["html"] = result["html"]
            current["build"] = {
                "sourceHash": digest,
                "artifactHash": artifact_hash(result["html"]),
                "revision": current["revision"],
            }
            output = {"ok": True, "issues": [], "sourceHash": digest}
            self.emit("build_result", output)
            return output
        if name in ("validate_preview", "validate_implementation"):
            identity = self.identity()
            key = "reviewChecks" if name == "validate_preview" else "checks"
            checks = self.check_plan(current[key])
            report = validate_artifact(
                current["html"], validate_checks(checks), self.settings, self.cancelled
            )
            self.check()
            if report["artifactHash"] != identity["artifactHash"]:
                raise ValueError("Browser report does not match the current artifact.")
            evidence = {
                **report,
                **identity,
                "checksHash": checks_hash(checks),
                "scope": self.scope["path"],
            }
            evidence_key = (
                "independentValidation"
                if name == "validate_preview"
                else "implementationValidation"
            )
            current.update({evidence_key: evidence, "report": report, "review": None})
            self.emit("validation", report)
            return report
        raise ValueError("Unsupported source operation.")

    def durable_operation(self, step: str, name: str, args: dict) -> dict:
        self.check()
        scope = self.scope
        actor = {} if scope["role"] == "controller" else {"agent": scope["role"]}

        def perform() -> dict:
            self.check()
            self.emit("tool_start", {"id": step, "name": name, **actor})
            try:
                output = self.operation(name, args)
            except ValueError as error:
                output = {"error": str(error)[:2000]}
                if name == "build_project":
                    self.emit("build_result", {"ok": False, "issues": [output["error"]]})
            self.check()
            public = (
                {"revision": self.workspace["revision"]} if name.startswith("read_") else output
            )
            self.emit("tool_end", {"id": step, "name": name, **actor, "output": public})
            return {"output": output, "workspace": copy.deepcopy(self.workspace), "args": args}

        try:
            saved = self.durable.run(step, perform)
        except Exception as error:
            raise RuntimeAbort(error) from None
        self.check()
        if saved["args"] != args:
            raise HarnessFailure("internal")
        self.workspace = copy.deepcopy(saved["workspace"])
        if "error" not in saved["output"]:
            if name in ("write_file", "edit_file"):
                self.emit(
                    "file_saved",
                    {
                        "path": args["path"],
                        "content": self.workspace["source"]["files"][args["path"]],
                    },
                )
            elif name == "delete_file":
                self.emit("file_deleted", {"path": args["path"]})
        return saved["output"]

    def tool(
        self, name: str, description: str, schema: type[BaseModel], terminal: bool = False
    ) -> Tool:
        def execute(**kwargs: Any) -> str:
            self.check()
            args = schema.model_validate(kwargs).model_dump()
            scope = self.scope
            index = scope["tool_index"]
            scope["tool_index"] += 1
            output = self.durable_operation(f"{scope['path']}/tool-{index}-{name}", name, args)
            return json.dumps(output, ensure_ascii=False)

        return Tool(
            name=name,
            description=description,
            args_schema=schema,
            func=execute,
            result_as_answer=terminal,
            cache_function=lambda *_: False,
        )

    def tools(self, role: str) -> list[Tool]:
        available = {
            "read_workspace": (
                "Read exact request, frozen contract, source inventory and evidence.",
                NoArgs,
            ),
            "read_previous_file": ("Read a file from the immutable accepted baseline.", PathArgs),
            "read_file": ("Read the exact current file before editing.", PathArgs),
            "read_review_files": (
                "Inspect current and immutable baseline files together, including deletions.",
                ReviewFilesArgs,
            ),
            "submit_contract": (
                "Freeze grounded requirements and capability needs once; terminates analysis.",
                ContractArgs,
            ),
            "initialize_project": (
                "Initialize vanilla or react-ts source; existing projects cannot be reset.",
                InitializeArgs,
            ),
            "write_file": (
                "Create or replace source. Supply path before content. package.json is protected.",
                WriteArgs,
            ),
            "edit_file": (
                "Apply unique literal edits atomically, preserving unrelated code.",
                EditArgs,
            ),
            "delete_file": ("Delete obsolete source; required files remain protected.", PathArgs),
            "set_acceptance_checks": (
                "Set implementation checks covering every supported frozen requirementId. "
                + CHECK_INSTRUCTIONS,
                ChecksArgs,
            ),
            "set_review_checks": (
                "Set independent checks covering every supported frozen requirementId. "
                + CHECK_INSTRUCTIONS,
                ChecksArgs,
            ),
            "finish_candidate": (
                "Finish a coherent implementation and check plan; controller will save and validate it.",
                CandidateArgs,
            ),
            "validate_preview": (
                "Execute your independent checks in the real isolated browser on the exact artifact.",
                NoArgs,
            ),
            "record_review": (
                "Record substantive requirement-linked independent acceptance or concrete repair findings.",
                ReviewArgs,
            ),
        }
        names = {
            "emma": ["read_workspace", "read_previous_file", "submit_contract"],
            "alex": [
                "read_workspace",
                "read_previous_file",
                "read_file",
                "initialize_project",
                "write_file",
                "edit_file",
                "delete_file",
                "set_acceptance_checks",
                "finish_candidate",
            ],
            "david": [
                "read_workspace",
                "read_review_files",
                "set_review_checks",
                "validate_preview",
                "record_review",
            ],
        }[role]
        return [
            self.tool(
                name,
                *available[name],
                terminal=name in ("submit_contract", "finish_candidate", "record_review"),
            )
            for name in names
            if self.previous or name != "read_previous_file"
        ]

    def work_packet(self, diagnostics: list[dict], round_index: int) -> dict:
        return {
            "request": self.context["request"],
            "contract": copy.deepcopy(self.workspace["contract"]),
            "capabilities": copy.deepcopy(CAPABILITIES),
            "baseline": copy.deepcopy(self.context.get("previousSource")),
            "current": self.workspace_info(),
            "diagnostics": copy.deepcopy(diagnostics),
            "repairRound": round_index,
            "remainingRepairs": MAX_REPAIRS - round_index,
        }

    def run_stage(self, role: str, path: str, packet: dict) -> str:
        self.check()
        parent_scope = self.scope
        initial = copy.deepcopy(self.workspace)

        def execute() -> dict:
            self.check()
            self.workspace = copy.deepcopy(initial)
            self.scope = self.new_scope(path, role)
            message_id = self.scope["message_id"]
            instructions = ITERATION_INSTRUCTIONS + "\n\n" if self.previous else ""
            agent = Agent(
                role=role.title(),
                goal=ROLE_GOALS[role],
                backstory=f"{TEAM_INSTRUCTIONS}\n\n{instructions}{ROLE_INSTRUCTIONS[role]}",
                llm=self.model_factory(),
                tools=self.tools(role),
                allow_delegation=False,
                allow_code_execution=False,
                max_iter=48 if role == "alex" else 80 if role == "david" else 12,
                max_retry_limit=0,
                cache=False,
                verbose=False,
                checkpoint=False,
                executor_class=SourceExecutor,
            )
            task = Task(
                description=json.dumps(packet, ensure_ascii=False),
                agent=agent,
                expected_output="Complete the assigned stage with its terminal tool and factual evidence.",
            )
            crew = Crew(
                agents=[agent],
                tasks=[task],
                process=Process.sequential,
                cache=False,
                memory=False,
                planning=False,
                verbose=False,
                tracing=False,
                share_crew=False,
                checkpoint=False,
            )
            self.emit("agent_start", {"id": role, "name": role.title()})
            self.emit("message_start", {"id": message_id, "role": "agent", "agent": role})
            result = crew.kickoff()
            self.check()
            self.emit(
                "message_done",
                {
                    "id": message_id,
                    "role": "agent",
                    "agent": role,
                    "content": result.raw,
                    "createdAt": int(time.time() * 1000),
                },
            )
            self.emit("agent_end", {"id": role, "name": role.title()})
            return {"workspace": copy.deepcopy(self.workspace), "result": result.raw}

        try:
            # Never wrap a Crew in durable.run: native model/tool calls are
            # sibling DBOS steps, independently replayable after process death.
            saved = self.durable.orchestrate(path, execute)
            self.check()
            self.workspace = copy.deepcopy(saved["workspace"])
            self.emit("project_reset", {"source": self.workspace["source"]})
            return saved["result"]
        except Exception as error:
            raise RuntimeAbort(error) from None
        finally:
            self.scope = parent_scope

    def persist_candidate(self, index: int) -> None:
        self.check()
        source = self.workspace["source"]
        if not source:
            return
        validate_source(source)
        built = current_build(self.workspace)
        candidate = {
            "source": copy.deepcopy(source),
            "sourceHash": source_hash(source),
            "html": self.workspace["html"] if built else None,
            "artifactHash": built["artifactHash"] if built else None,
            "contract": copy.deepcopy(self.workspace["contract"]),
        }
        saved = self.durable.run(f"flow-v2/candidate/{index:06d}", lambda: candidate)
        self.check()
        if saved != candidate:
            raise HarnessFailure("internal")

    def fail_workflow(self, code: str, reason: str, diagnostics: list[dict]) -> None:
        self.check()
        self.durable.run(
            "flow-v2/failure",
            lambda: {
                "code": code,
                "reason": reason,
                "diagnostics": diagnostics,
                "sourceHash": source_hash(self.workspace["source"])
                if self.workspace["source"]
                else None,
            },
        )
        self.check()
        raise HarnessFailure(code)

    def run_workflow(self) -> dict:
        self.run_stage("emma", "flow-v2/analyze", self.work_packet([], 0))
        if not self.workspace["contract"]:
            self.persist_candidate(0)
            self.fail_workflow(
                "validation", "Analysis did not produce a grounded frozen contract.", []
            )
        diagnostics: list[dict] = []
        failed_states: set[str] = set()
        last_candidate: str | None = None
        for round_index in range(MAX_REPAIRS + 1):
            self.check()
            if diagnostics:
                self.emit(
                    "repair",
                    {
                        "attempt": round_index,
                        "issues": [json.dumps(item, ensure_ascii=False) for item in diagnostics],
                    },
                )
            self.workspace["candidateSummary"] = None
            implementation_result = self.run_stage(
                "alex",
                f"flow-v2/implement/{round_index}",
                self.work_packet(diagnostics, round_index),
            )
            if not self.workspace["candidateSummary"]:
                self.workspace["candidateSummary"] = implementation_result
            self.persist_candidate(2 * round_index)
            if not self.workspace["source"]:
                self.fail_workflow(
                    "capability" if self.workspace["contract"]["blockers"] else "validation",
                    "Implementation did not produce candidate source.",
                    diagnostics,
                )
            candidate_state = checks_hash(
                {"source": self.workspace["source"], "checks": self.workspace["checks"]}
            )
            if candidate_state == last_candidate:
                self.fail_workflow(
                    "validation",
                    "Repair made no source or check-plan change; candidate retained.",
                    diagnostics,
                )
            last_candidate = candidate_state
            self.scope = self.new_scope(f"flow-v2/controller/{round_index}", "controller")
            compilation = self.durable_operation(
                f"flow-v2/compile/{round_index}", "build_project", {}
            )
            if "error" not in compilation:
                # Save compiled work before browser events trigger detail refresh.
                self.persist_candidate(2 * round_index + 1)
            if self.workspace["contract"]["blockers"]:
                self.fail_workflow(
                    "capability",
                    "Requested runtime capabilities are unavailable; candidate is unaccepted.",
                    self.workspace["contract"]["blockers"],
                )
            if "error" in compilation:
                diagnostics = [{"gate": "compile", "error": compilation["error"]}]
            else:
                report = self.durable_operation(
                    f"flow-v2/validate/{round_index}", "validate_implementation", {}
                )
                if "error" in report or not report.get("valid"):
                    diagnostics = [{"gate": "implementation_browser", "report": report}]
                else:
                    self.workspace.update(
                        review=None, independentValidation=None, reviewChecks=[], reviewedPaths=[]
                    )
                    self.run_stage(
                        "david", f"flow-v2/review/{round_index}", self.work_packet([], round_index)
                    )
                    self.check()
                    if completion_status(self.workspace)["ready"]:
                        return {
                            "source": self.workspace["source"],
                            "html": self.workspace["html"],
                            "summary": self.workspace["candidateSummary"],
                        }
                    diagnostics = [
                        {
                            "gate": "independent_review",
                            "review": self.workspace["review"],
                            "report": self.workspace["report"],
                            "missing": completion_status(self.workspace)["missing"],
                        }
                    ]
            failure_state = checks_hash(
                {
                    "sourceHash": source_hash(self.workspace["source"]),
                    "checks": self.workspace["checks"],
                    "diagnostics": diagnostics,
                }
            )
            if failure_state in failed_states or round_index == MAX_REPAIRS:
                self.fail_workflow(
                    "validation",
                    "Concrete repair allowance exhausted or candidate diagnostics repeated; candidate retained.",
                    diagnostics,
                )
            failed_states.add(failure_state)


class SourceExecutor(AgentExecutor):
    """Keep native tool execution ordered even if a provider ignores its flag."""

    @classmethod
    def flow_definition(cls) -> FlowDefinition:
        # CrewAI 1.15.40 only discovers decorated methods on the concrete class.
        # Reuse its native graph; methods still bind to this ordered executor.
        return AgentExecutor.flow_definition()

    def _should_parallelize_native_tool_calls(self, tool_calls: list[Any]) -> bool:
        return False


def execute_harness(
    settings: Any, context: dict, durable: Any, emit: Callable, cancelled: Callable
) -> dict:
    key = settings.openai_api_key
    if hasattr(key, "get_secret_value"):
        key = key.get_secret_value()
    if not key:
        raise HarnessFailure("provider")
    runtime = Runtime(settings, context, durable, emit, cancelled)
    runtime.check()
    llms: list[ObservedOpenAI] = []

    def model() -> ObservedOpenAI:
        llm = ObservedOpenAI(
            model=settings.model,
            api_key=key,
            base_url=settings.endpoint,
            custom_openai=bool(settings.endpoint),
            api="completions",
            stream=True,
            timeout=120.0,
            max_retries=0,
            additional_params={"parallel_tool_calls": False},
        ).bind(runtime)
        llms.append(llm)
        return llm

    runtime.model_factory = model
    try:
        return runtime.run_workflow()
    finally:
        for llm in llms:
            if llm._client is not None:
                llm._client.close()
