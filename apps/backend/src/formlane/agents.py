"""Code-orchestrated CrewAI Flow with granular DBOS model/tool replay (ADR-0015).

The Flow owns stage order and repair bounds; models own content; the sandboxed
browser and the source/artifact/check-bound completion gate own acceptance.
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import time
import uuid
from concurrent.futures import CancelledError
from types import MappingProxyType
from typing import Any, Callable, Literal

# Set before importing CrewAI; neither prompts nor provider credentials leave via telemetry.
os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CREWAI_TRACING_ENABLED"] = "false"

from crewai import Agent, Task
from crewai.agents.agent_executor import AgentExecutor
from crewai.flow.flow import Flow, listen, or_, router, start
from crewai.flow.flow_definition import FlowDefinition
from crewai.tools.base_tool import Tool
from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, field_validator, model_validator

from .compiler import compile_project
from .model_stream import ObservedOpenAI, RuntimeAbort
from .project import artifact_hash, create_source, is_project_path, source_hash, validate_source
from .prompts import (
    BUILDER_INSTRUCTIONS,
    ITERATION_INSTRUCTIONS,
    PLANNER_INSTRUCTIONS,
    QUICK_EDIT_ADDENDUM,
    REPAIR_ADDENDUM,
    REVIEWER_INSTRUCTIONS,
    ROUTER_INSTRUCTIONS,
    TEAM_INSTRUCTIONS,
)
from .validator import inspect_artifact, validate_artifact, validate_checks

FLOW_VERSION = "flow-v1"
# Deterministic verification is free; model repair rounds are bounded per phase.
MAX_VERIFY_REPAIRS = 2
MAX_REVIEW_REPAIRS = 1
SMOKE_CHECK_NAME = "smoke: 375px render without runtime errors"
SMOKE_CHECK = {
    "name": SMOKE_CHECK_NAME,
    "viewport": {"width": 375, "height": 812},
    "actions": [],
    "assertions": [
        {
            "kind": "no-horizontal-overflow",
            "selector": "body",
            "expected": "true",
            "attribute": None,
        }
    ],
}


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


class Clock(NoArgs):
    now: str = Field(min_length=10, max_length=40)
    timezone: str | None = None


class BrowserCheck(NoArgs):
    name: str = Field(min_length=1, max_length=160)
    viewport: Viewport | None = None
    clock: Clock | None = None
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    actions: list[BrowserAction] = Field(max_length=16)
    assertion: BrowserAssertion | None = None
    assertions: list[BrowserAssertion] = Field(default_factory=list, max_length=12)


class ChecksArgs(NoArgs):
    # One slot is reserved for the harness smoke check.
    checks: list[BrowserCheck] = Field(min_length=2, max_length=15)


class ReviewArgs(NoArgs):
    accepted: bool
    findings: str = Field(min_length=1, max_length=6000)


class Criterion(NoArgs):
    id: str = Field(min_length=1, max_length=8)
    outcome: str = Field(min_length=1, max_length=600)


class PlanArgs(NoArgs):
    brief: str = Field(min_length=1, max_length=2000)
    criteria: list[Criterion] = Field(min_length=2, max_length=8)
    assumptions: list[str] = Field(default_factory=list, max_length=8)
    gaps: list[str] = Field(default_factory=list, max_length=8)
    template: Literal["vanilla", "react-ts"] | None
    architecture: str = Field(min_length=1, max_length=6000)
    checks: list[BrowserCheck] = Field(min_length=2, max_length=12)


class RouteArgs(NoArgs):
    route: Literal["quick_edit", "plan"]
    reason: str = Field(min_length=1, max_length=600)


class SubmitArgs(NoArgs):
    summary: str = Field(min_length=1, max_length=2000)
    # Failing checks the builder believes are wrong; the reviewer owns their correction.
    check_defects: list[str] = Field(default_factory=list, max_length=16)


class InspectArgs(NoArgs):
    selector: str = Field(default="body", min_length=1, max_length=300)
    viewport: Viewport | None = None
    clock: Clock | None = None
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    actions: list[BrowserAction] = Field(default_factory=list, max_length=16)


class SearchArgs(NoArgs):
    query: str = Field(min_length=1, max_length=200)
    ignore_case: bool = True


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


def checks_hash(checks: list[dict]) -> str:
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


# Observation is cheap per call but unbounded exploration exhausted a review stage
# (22 inspections, no verdict). Budgets force a decision with the evidence at hand.
TOOL_BUDGETS = {
    "alex": {"inspect_preview": 12, "validate_preview": 8},
    "david": {"inspect_preview": 6, "validate_preview": 3, "set_acceptance_checks": 2},
}
BUDGET_NEXT = {
    "alex": "Submit now with submit_candidate, naming disputed failing checks in check_defects.",
    "david": "Decide with the evidence you have and call record_review now.",
}
DATE_LITERAL = re.compile(
    r"\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*[日号]"
)


def require_clock_coverage(checks: list[dict]) -> None:
    """Calendar expectations need a pinned clock at two moments, or hardcoding passes."""
    dated = [
        check
        for check in checks
        if any(
            DATE_LITERAL.search(item["expected"])
            for item in ([check["assertion"]] if check.get("assertion") else [])
            + check["assertions"]
        )
    ]
    if not dated:
        return
    if any(not check.get("clock") for check in dated):
        raise ValueError(
            "Checks that assert calendar dates must set clock.now so 'today' is deterministic."
        )
    if len({check["clock"]["now"] for check in checks if check.get("clock")}) < 2:
        raise ValueError(
            "Time-relative behavior needs checks at two different clock.now values; "
            "a single moment cannot distinguish computed dates from hardcoded ones."
        )


def search_source(source: dict, query: str, ignore_case: bool) -> dict:
    needle = query.lower() if ignore_case else query
    matches = []
    for path, content in sorted(source["files"].items()):
        for number, line in enumerate(content.splitlines(), 1):
            if needle in (line.lower() if ignore_case else line):
                matches.append({"path": path, "line": number, "text": line.strip()[:240]})
                if len(matches) >= 80:
                    return {"matches": matches, "truncated": True}
    return {"matches": matches, "truncated": False}


def with_smoke(checks: list[dict]) -> list[dict]:
    """Every check set starts with the fixed render/runtime-error smoke check."""
    return [SMOKE_CHECK, *(check for check in checks if check.get("name") != SMOKE_CHECK_NAME)]


def current_visual_review(workspace: dict) -> dict | None:
    built = current_build(workspace)
    evidence = workspace.get("visualReview")
    if (
        not built
        or not evidence
        or not evidence.get("screenshots")
        or any(evidence.get(key) != built[key] for key in built)
        or any(
            not image.get("sha256") or any(image.get(key) != built[key] for key in built)
            for image in evidence["screenshots"]
        )
    ):
        return None
    return evidence


def completion_status(workspace: dict) -> dict:
    build = current_build(workspace)
    missing = []
    if not build:
        missing.append("current_build")
    implementation = workspace["implementationValidation"]
    if (
        not build
        or not implementation
        or any(implementation.get(key) != build[key] for key in ("sourceHash", "artifactHash"))
    ):
        missing.append("alex_validation")
    check_hash = checks_hash(workspace["checks"])
    independent = workspace["independentValidation"]
    if (
        not build
        or not independent
        or independent.get("artifactHash") != build["artifactHash"]
        or independent.get("checksHash") != check_hash
    ):
        missing.append("david_validation")
    visual = current_visual_review(workspace)
    if not visual:
        missing.append("david_visual_review")
    review = workspace["review"]
    if (
        not build
        or not review
        or not review["accepted"]
        or any(review.get(key) != build[key] for key in ("sourceHash", "artifactHash"))
        or review.get("checksHash") != check_hash
        or not visual
        or review.get("visualEvidence") != visual["screenshots"]
    ):
        missing.append("david_acceptance")
    return {"ready": not missing, "missing": missing}


def render_brief(plan: dict) -> str:
    lines = [plan["brief"], ""]
    lines += [f"{item['id']}. {item['outcome']}" for item in plan["criteria"]]
    if plan["assumptions"]:
        lines += ["", *(f"- {item}" for item in plan["assumptions"])]
    if plan["gaps"]:
        lines += ["", *(f"! {item}" for item in plan["gaps"])]
    return "\n".join(lines)


class Runtime:
    """Workspace, role-scoped tools and durable operation journal for one run."""

    def __init__(
        self, settings: Any, context: dict, durable: Any, emit: Callable, cancelled: Callable
    ):
        self.settings, self.context = settings, context
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
        checks: list[dict] = []
        if previous and context.get("previousChecks"):
            try:
                checks = validate_checks(with_smoke(context["previousChecks"]))
            except ValueError:
                checks = []  # Saved before the current check contract; replan instead.
        self.workspace = {
            "plan": None,
            "brief": "",
            "architecture": "",
            "route": None,
            "source": copy.deepcopy(previous),
            "html": "",
            "build": None,
            "checks": checks,
            "report": None,
            "validatedBy": None,
            "implementationValidation": None,
            "independentValidation": None,
            "visualReview": None,
            "review": None,
            "candidate": None,
            "revision": 0,
            "reviewedPaths": [],
        }
        self.scope = self.new_scope(f"{FLOW_VERSION}/mike", "mike")
        self.candidate_index = 0

    def new_scope(self, path: str, role: str) -> dict:
        return {
            "path": path,
            "role": role,
            "message_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{self.context['runId']}:{path}")),
            "llm_index": 0,
            "tool_index": 0,
            "uses": {},
            "images": [],
        }

    def begin_model_call(self, scope: dict) -> None:
        self.check()

    def model_messages(self, messages: Any) -> tuple[Any, list[dict]]:
        """Attach private images only at the native provider boundary, never to Crew text."""
        built = current_build(self.workspace)
        images = [
            image
            for image in self.scope["images"]
            if built and all(image.get(key) == built[key] for key in built)
        ]
        if not images:
            return messages, []
        evidence = [
            {key: value for key, value in image.items() if key != "data"} for image in images
        ]
        content = [
            {
                "type": "text",
                "text": "Current-build viewport screenshots from inspect_preview: "
                + json.dumps(evidence, ensure_ascii=False),
            }
        ]
        content.extend(
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{image['mimeType']};base64,{image['data']}",
                    "detail": "high",
                },
            }
            for image in images
        )
        history = (
            [{"role": "user", "content": messages}] if isinstance(messages, str) else list(messages)
        )
        return [*history, {"role": "user", "content": content}], evidence

    def record_visual_delivery(self, step: str, evidence: list[dict]) -> None:
        """Called only after a committed native model response, including durable replay."""
        built = current_build(self.workspace)
        if (
            self.scope["role"] == "david"
            and built
            and evidence
            and all(all(image.get(key) == built[key] for key in built) for image in evidence)
        ):
            self.workspace["visualReview"] = {
                **built,
                "modelStep": step,
                "screenshots": copy.deepcopy(evidence),
            }

    def check(self) -> None:
        if self.cancelled():
            raise CancelledError()

    def clear_evidence(self) -> None:
        self.scope["images"].clear()
        self.workspace.update(
            html="",
            build=None,
            report=None,
            validatedBy=None,
            implementationValidation=None,
            independentValidation=None,
            visualReview=None,
            review=None,
            candidate=None,
            reviewedPaths=[],
        )

    def invalidate(self, source: dict) -> None:
        validate_source(source)
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
            "userRequest": self.context["request"],
            "completion": completion_status(current),
            **({} if self.previous else {"originalIdea": self.context["idea"]}),
        }

    def operation(self, name: str, args: dict) -> dict:
        self.check()
        current = self.workspace
        source = current["source"]
        role = self.scope["role"]
        if name == "read_workspace":
            return self.workspace_info()
        if name == "read_previous_file":
            if not self.previous or args["path"] not in self.previous["files"]:
                raise ValueError("File does not exist in the saved baseline.")
            return {"path": args["path"], "content": self.previous["files"][args["path"]]}
        if name == "read_review_files":
            files = (source or {}).get("files", {})
            baseline = self.previous["files"] if self.previous else {}
            statuses = {
                item["path"]: item["status"] for item in source_changes(source, self.previous)
            }
            paths = list(dict.fromkeys(args["paths"]))
            current["reviewedPaths"] = sorted(set(current["reviewedPaths"]) | set(paths))
            return {
                "revision": current["revision"],
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
        if name == "choose_route":
            current["route"] = args["route"]
            return dict(args)
        if name == "submit_plan":
            if current["plan"] is not None:
                raise ValueError("The plan was already submitted.")
            checks = validate_checks(with_smoke(args["checks"]))
            require_clock_coverage(checks)
            if not source:
                if not args["template"]:
                    raise ValueError("Choose vanilla or react-ts for a new project.")
                self.invalidate(create_source(args["template"]))
                self.emit(
                    "project_initialized",
                    {"source": current["source"], "reason": args["architecture"][:2000]},
                )
            plan = {
                key: args[key]
                for key in ("brief", "criteria", "assumptions", "gaps", "architecture")
            }
            current.update(
                plan=plan,
                brief=render_brief(plan),
                architecture=args["architecture"],
                checks=checks,
                report=None,
                validatedBy=None,
                independentValidation=None,
                review=None,
            )
            return {
                "template": current["source"]["template"],
                "files": sorted(current["source"]["files"]),
                "checks": len(checks),
            }
        if name == "set_acceptance_checks":
            checks = validate_checks(with_smoke(args["checks"]))
            require_clock_coverage(checks)
            # Implementation evidence is check-independent; independent evidence is not.
            current.update(
                checks=checks,
                report=None,
                validatedBy=None,
                independentValidation=None,
                review=None,
            )
            return {"checks": len(checks), "revision": current["revision"]}
        if name == "record_review":
            built = current_build(current)
            changed = {
                item["path"]
                for item in source_changes(source, self.previous)
                if item["status"] != "unchanged"
            }
            independent = current["independentValidation"]
            if args["accepted"] and (
                not built
                or not independent
                or independent["artifactHash"] != built["artifactHash"]
                or independent["checksHash"] != checks_hash(current["checks"])
                or not current_visual_review(current)
                or not changed.issubset(current["reviewedPaths"])
            ):
                raise ValueError(
                    "Acceptance requires your own passing current-artifact browser validation, "
                    "delivered current-build screenshots and inspection of every changed baseline file."
                )
            current["review"] = {
                **args,
                "sourceHash": built["sourceHash"] if built else "",
                "artifactHash": built["artifactHash"] if built else "",
                "checksHash": checks_hash(current["checks"]),
                "visualEvidence": copy.deepcopy(
                    (current_visual_review(current) or {}).get("screenshots", [])
                ),
            }
            return {**current["review"], "completion": completion_status(current)}
        if not source:
            raise ValueError("No project exists yet; the plan initializes it.")
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
                "message": "Source changed. Build before submitting.",
            }
        if name == "build_project":
            self.clear_evidence()
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
        if name == "search_files":
            return search_source(source, args["query"], args["ignore_case"])
        if name == "inspect_preview":
            built = current_build(current)
            if not built:
                raise ValueError("Build current source successfully before inspecting it.")
            result = inspect_artifact(current["html"], args, self.settings, self.cancelled)
            if result["screenshot"]["artifactHash"] != built["artifactHash"]:
                raise ValueError("Screenshot does not match the current artifact.")
            result["screenshot"].update(built)
            return result
        if name == "submit_candidate":
            built = current_build(current)
            if not built:
                raise ValueError("Build the current source successfully before submitting.")
            implementation = current["implementationValidation"]
            passed = implementation and all(
                implementation.get(key) == built[key] for key in ("sourceHash", "artifactHash")
            )
            report = current["report"]
            failing = (
                {item["name"] for item in report["checks"] if not item["passed"]}
                if report and report["artifactHash"] == built["artifactHash"]
                else None
            )
            if not passed:
                if failing is None:
                    raise ValueError("Run validate_preview on the current build before submitting.")
                if not args["check_defects"] or not failing.issubset(args["check_defects"]):
                    raise ValueError(
                        "Validation is failing. Fix the application, or list every failing check "
                        "you can show is itself wrong in check_defects: "
                        + ", ".join(sorted(failing))
                    )
            current["candidate"] = {
                "summary": args["summary"],
                "revision": current["revision"],
                "checkDefects": [] if passed else sorted(args["check_defects"]),
            }
            return {"submitted": True, "revision": current["revision"]}
        if name == "validate_preview":
            built = current_build(current)
            if not built:
                raise ValueError("Build current source successfully before validation.")
            checks = validate_checks(current["checks"])
            report = validate_artifact(current["html"], checks, self.settings, self.cancelled)
            self.check()
            if report["artifactHash"] != built["artifactHash"]:
                raise ValueError("Browser report does not match the current artifact.")
            current.update(report=report, validatedBy=role)
            if role == "david":
                current["review"] = None
                current["independentValidation"] = (
                    {"artifactHash": built["artifactHash"], "checksHash": checks_hash(checks)}
                    if report["valid"]
                    else None
                )
            else:
                current["implementationValidation"] = dict(built) if report["valid"] else None
            self.emit("validation", report)
            return report
        raise ValueError("Unsupported source operation.")

    def invoke(self, name: str, args: dict) -> dict:
        """Run one operation as a durable step; replay restores its workspace."""
        self.check()
        scope = self.scope
        index = scope["tool_index"]
        scope["tool_index"] += 1
        step = f"{scope['path']}/tool-{index}-{name}"

        def perform() -> dict:
            self.emit("tool_start", {"id": step, "name": name, "agent": scope["role"]})
            try:
                output = self.operation(name, args)
            except ValueError as error:
                output = {"error": str(error)[:2000]}
                if name == "build_project":
                    self.emit("build_result", {"ok": False, "issues": [output["error"]]})
            self.check()
            # Read results and source content stay out of the public tool transcript.
            public = (
                {"revision": self.workspace["revision"]}
                if name.startswith("read_")
                else self.tool_output(name, output)
            )
            self.emit(
                "tool_end", {"id": step, "name": name, "agent": scope["role"], "output": public}
            )
            return {"output": output, "workspace": copy.deepcopy(self.workspace), "args": args}

        try:
            saved = self.durable.run(step, perform)
        except Exception as error:
            raise RuntimeAbort(error) from None
        if saved["args"] != args:
            raise HarnessFailure("internal")
        self.workspace = copy.deepcopy(saved["workspace"])
        if "error" not in saved["output"]:
            if name in ("submit_plan", "write_file", "edit_file", "delete_file", "build_project"):
                scope["images"].clear()
            elif name == "inspect_preview" and "screenshot" in saved["output"]:
                scope["images"].append(copy.deepcopy(saved["output"]["screenshot"]))
        if "error" not in saved["output"] and name in (
            "submit_plan",
            "write_file",
            "edit_file",
            "delete_file",
            "build_project",
        ):
            self.persist_candidate()
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
        return self.tool_output(name, saved["output"])

    @staticmethod
    def tool_output(name: str, output: dict) -> dict:
        if name == "inspect_preview" and "screenshot" in output:
            return {
                **output,
                "screenshot": {
                    key: value for key, value in output["screenshot"].items() if key != "data"
                },
            }
        return output

    def persist_candidate(self) -> None:
        """Journal a private draft after its tool step, never inside another step."""
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
        }
        key = f"{FLOW_VERSION}/candidate/{self.candidate_index:06d}"
        self.candidate_index += 1
        try:
            saved = self.durable.run(key, lambda: candidate)
        except Exception as error:
            raise RuntimeAbort(error) from None
        self.check()
        if saved != candidate:
            raise HarnessFailure("internal")

    def tool(
        self, name: str, description: str, schema: type[BaseModel], terminal: bool = False
    ) -> Tool:
        def execute(**kwargs: Any) -> str:
            self.check()
            args = schema.model_validate(kwargs).model_dump()
            role = self.scope["role"]
            limit = TOOL_BUDGETS.get(role, {}).get(name)
            uses = self.scope["uses"]
            if limit is not None and uses.get(name, 0) >= limit:
                # Deterministic on replay: the same cached model calls hit the same count.
                return json.dumps(
                    {
                        "error": f"{name} budget of {limit} for this stage is used up. {BUDGET_NEXT[role]}"
                    }
                )
            uses[name] = uses.get(name, 0) + 1
            return json.dumps(self.invoke(name, args), ensure_ascii=False)

        return Tool(
            name=name,
            description=description,
            args_schema=schema,
            func=execute,
            result_as_answer=terminal,
            cache_function=lambda *_: False,
        )

    def tools(self, kind: str) -> list[Tool]:
        available = {
            "read_workspace": (
                "Read the plan, checks, source inventory, baseline changes, request and evidence.",
                NoArgs,
            ),
            "read_previous_file": (
                "Read a file from the immutable saved application baseline.",
                PathArgs,
            ),
            "read_file": ("Read the exact current file before editing.", PathArgs),
            "read_review_files": (
                "Read current and immutable baseline content together for related paths, including deletions.",
                ReviewFilesArgs,
            ),
            "choose_route": ("Route this follow-up to quick_edit or plan.", RouteArgs),
            "submit_plan": (
                "Submit the brief, criteria, architecture, template and acceptance checks once. "
                "Initializes a new project from the template.",
                PlanArgs,
            ),
            "write_file": (
                "Create or replace a source file. Supply path before content. package.json is protected.",
                WriteArgs,
            ),
            "edit_file": (
                "Atomically apply 1–8 unique literal edits; preserve unrelated source.",
                EditArgs,
            ),
            "delete_file": (
                "Delete obsolete source. Required files and package.json remain protected.",
                PathArgs,
            ),
            "build_project": (
                "Compile current source with the trusted compiler; generated scripts/configs never execute.",
                NoArgs,
            ),
            "submit_candidate": (
                "Submit the current build after validate_preview passes; if it fails only because "
                "checks are wrong, name them in check_defects. Ends your turn.",
                SubmitArgs,
            ),
            "inspect_preview": (
                "Observe the current build: viewport screenshot, accessibility tree, console, "
                "page errors and document width, optionally after actions, viewport and clock. "
                "The screenshot is attached as an image to your next model turn; behavioral checks remain required.",
                InspectArgs,
            ),
            "search_files": (
                "Find a literal text in current source files; returns path, line and text.",
                SearchArgs,
            ),
            "set_acceptance_checks": (
                "Replace the COMPLETE declarative check set (smoke check is added automatically).",
                ChecksArgs,
            ),
            "validate_preview": (
                "Run the acceptance checks in the sandboxed browser against the current build. "
                "Failures return actual values; fix and rerun.",
                NoArgs,
            ),
            "record_review": (
                "Record the independent verdict; acceptance requires your own passing validation "
                "and delivered current-build screenshots. Ends your turn.",
                ReviewArgs,
            ),
        }
        editing = [
            "read_file",
            "search_files",
            "write_file",
            "edit_file",
            "delete_file",
            "build_project",
            "inspect_preview",
            "validate_preview",
        ]
        names = {
            "router": ["choose_route"],
            "planner": ["read_workspace", "read_previous_file", "read_file", "submit_plan"],
            "builder": ["read_workspace", "read_previous_file", *editing, "submit_candidate"],
            "quick_edit": [
                "read_workspace",
                "read_previous_file",
                *editing,
                "set_acceptance_checks",
                "submit_candidate",
            ],
            "reviewer": [
                "read_workspace",
                "read_review_files",
                "search_files",
                "inspect_preview",
                "set_acceptance_checks",
                "validate_preview",
                "record_review",
            ],
        }[kind]
        terminal = {"choose_route", "submit_plan", "submit_candidate", "record_review"}
        baseline_only = {"read_previous_file"} | ({"read_file"} if kind == "planner" else set())
        return [
            self.tool(name, *available[name], terminal=name in terminal)
            for name in names
            if self.previous or name not in baseline_only
        ]

    def scoped(self, key: str, role: str):
        runtime = self

        class Scope:
            def __enter__(self):
                runtime.check()
                self.parent = runtime.scope
                path = f"{FLOW_VERSION}/{key}"
                runtime.scope = runtime.new_scope(path, role)
                self.events = runtime.durable.events(path)
                self.events.__enter__()
                return runtime.scope

            def __exit__(self, *exc):
                self.events.__exit__(*exc)
                runtime.scope = self.parent
                return False

        return Scope()


class SourceExecutor(AgentExecutor):
    """Keep native tool execution ordered even if a provider ignores its flag."""

    @classmethod
    def flow_definition(cls) -> FlowDefinition:
        # CrewAI 1.15.40 only discovers decorated methods on the concrete class.
        # Reuse its native graph; methods still bind to this ordered executor.
        return AgentExecutor.flow_definition()

    def _should_parallelize_native_tool_calls(self, tool_calls: list[Any]) -> bool:
        return False


STAGES = {
    # kind: (persona, instructions, max model iterations, reasoning effort)
    # Unset effort defaults to deep reasoning: one plan took 306 s; low planned 2048 in 53 s.
    "router": ("mike", ROUTER_INSTRUCTIONS, 3, "low"),
    "planner": ("emma", PLANNER_INSTRUCTIONS, 10, "low"),
    "builder": ("alex", BUILDER_INSTRUCTIONS, 50, "medium"),
    "quick_edit": ("alex", f"{BUILDER_INSTRUCTIONS}\n\n{QUICK_EDIT_ADDENDUM}", 40, "medium"),
    "repair": ("alex", f"{BUILDER_INSTRUCTIONS}\n\n{REPAIR_ADDENDUM}", 30, "medium"),
    "reviewer": ("david", REVIEWER_INSTRUCTIONS, 30, "medium"),
}
NAMES = {"mike": "Mike", "emma": "Emma", "bob": "Bob", "alex": "Alex", "david": "David"}


class Delivery:
    """Stage implementations; DeliveryFlow decides their order."""

    def __init__(self, runtime: Runtime, model: Callable[[str | None], ObservedOpenAI]):
        self.rt, self.model = runtime, model

    @property
    def workspace(self) -> dict:
        return self.rt.workspace

    def agent(self, kind: str) -> Agent:
        persona, instructions, iterations, effort = STAGES[kind]
        baseline = f"{ITERATION_INSTRUCTIONS}\n\n" if self.rt.previous else ""
        tools = self.rt.tools("builder" if kind == "repair" else kind)
        return Agent(
            role=NAMES[persona],
            goal=instructions.split("\n", 1)[0],
            backstory=f"{TEAM_INSTRUCTIONS}\n\n{baseline}{instructions}",
            llm=self.model(effort),
            tools=tools,
            allow_delegation=False,
            allow_code_execution=False,
            max_iter=iterations,
            max_retry_limit=0,
            cache=False,
            verbose=False,
            checkpoint=False,
            executor_class=SourceExecutor,
        )

    def say(self, persona: str, message_id: str, content: str) -> None:
        self.rt.emit("message_start", {"id": message_id, "role": "agent", "agent": persona})
        self.rt.emit(
            "message_done",
            {
                "id": message_id,
                "role": "agent",
                "agent": persona,
                "content": content,
                "createdAt": int(time.time() * 1000),
            },
        )

    def stage(self, key: str, kind: str, label: str, task: dict, message: Callable[[str], str]):
        persona = STAGES[kind][0]
        with self.rt.scoped(key, persona) as scope:
            visible = persona != "mike"
            if visible:
                self.rt.emit(
                    "tool_start",
                    {
                        "id": scope["path"],
                        "name": f"delegate_{persona}",
                        "agent": "mike",
                        "childAgent": persona,
                        "input": label,
                    },
                )
                self.rt.emit("agent_start", {"id": persona, "name": NAMES[persona], "task": label})
            agent = self.agent(kind)
            native = Task(
                description=json.dumps({"stage": label, **task}, ensure_ascii=False),
                expected_output="Call your terminal tool with the stage result.",
                agent=agent,
            )
            try:
                output = str(agent.execute_task(native, None, agent.tools))
            except RuntimeAbort:
                raise
            except Exception as error:
                raise RuntimeAbort(error) from None
            self.rt.check()
            content = message(output)
            if visible:
                self.say(persona, scope["message_id"], content)
                self.rt.emit("agent_end", {"id": persona, "name": NAMES[persona]})
                self.rt.emit(
                    "tool_end",
                    {
                        "id": scope["path"],
                        "name": f"delegate_{persona}",
                        "agent": "mike",
                        "childAgent": persona,
                        "output": content[:3000],
                    },
                )
            elif content:
                self.say("mike", scope["message_id"], content)
            return output

    def route(self) -> str:
        if not self.rt.previous:
            return "plan"
        self.stage(
            "route",
            "router",
            "Route follow-up",
            {
                "request": self.rt.context["request"],
                "template": self.rt.previous["template"],
                "files": sorted(self.rt.previous["files"]),
                "savedChecks": [check["name"] for check in self.workspace["checks"]],
            },
            lambda _: "",
        )
        route = self.workspace["route"]
        # Without saved checks there is no regression baseline for a quick edit.
        return route if route == "quick_edit" and self.workspace["checks"] else "plan"

    def plan(self) -> None:
        for attempt in range(2):
            self.stage(
                f"plan-{attempt}",
                "planner",
                "Define the brief, architecture and acceptance checks",
                {"request": self.rt.context["request"], "workspace": self.rt.workspace_info()},
                lambda output: self.workspace["brief"] or output,
            )
            if self.workspace["plan"]:
                break
        else:
            raise HarnessFailure("step_limit")
        # Bob's architecture comes from the same structured plan, shown as his handoff.
        with self.rt.scoped("plan-architecture", "bob") as scope:
            self.rt.emit("agent_start", {"id": "bob", "name": "Bob", "task": "Architecture"})
            self.say("bob", scope["message_id"], self.workspace["architecture"])
            self.rt.emit("agent_end", {"id": "bob", "name": "Bob"})

    def implement(self, kind: str, key: str, label: str, evidence: Any = None) -> None:
        task = {"request": self.rt.context["request"]}
        if kind in ("builder", "quick_edit"):
            task["workspace"] = self.rt.workspace_info()
        if kind == "builder" and not self.rt.previous:
            task["templateFiles"] = dict(self.workspace["source"]["files"])
        if evidence is not None:
            task["evidence"] = evidence
        self.stage(
            key,
            kind,
            label,
            task,
            lambda output: (self.workspace["candidate"] or {}).get("summary") or output,
        )

    def check_candidate(self, key: str) -> dict:
        """Deterministic build + browser validation attributed to implementation."""
        with self.rt.scoped(key, "alex"):
            if not current_build(self.workspace):
                built = self.rt.invoke("build_project", {})
                if "error" in built:
                    return {"valid": False, "issues": [built["error"]]}
            report = self.rt.invoke("validate_preview", {})
            if "error" in report:
                return {"valid": False, "issues": [report["error"]]}
            return report

    def repair(self, key: str, issues: list) -> None:
        with self.rt.scoped(f"{key}-notice", "alex"):
            self.rt.emit("repair", {"attempt": self.workspace["revision"] + 1, "issues": issues})
        self.implement("repair", key, "Repair the reported defects", {"failures": issues})

    def verify(self) -> None:
        """Gate the builder's own evidence; browser work only repeats when it is stale."""
        for round in range(MAX_VERIFY_REPAIRS + 1):
            built = current_build(self.workspace)
            implementation = self.workspace["implementationValidation"]
            if (
                built
                and implementation
                and all(
                    implementation.get(key) == built[key] for key in ("sourceHash", "artifactHash")
                )
            ):
                return
            report = self.check_candidate(f"verify-{round}")
            candidate = self.workspace["candidate"] or {}
            failing = {item["name"] for item in report.get("checks", []) if not item["passed"]}
            disputed = failing and failing.issubset(candidate.get("checkDefects", []))
            if report["valid"] or disputed or round == MAX_VERIFY_REPAIRS:
                # Disputed or remaining failures may be check defects, which the reviewer owns.
                return
            self.repair(f"repair-{round}", report["issues"])

    def review(self) -> None:
        for round in range(MAX_REVIEW_REPAIRS + 1):
            plan = self.workspace["plan"] or {}
            self.stage(
                f"review-{round}",
                "reviewer",
                "Independently validate and review the current build",
                {"request": self.rt.context["request"], "criteria": plan.get("criteria", [])},
                lambda output: (self.workspace["review"] or {}).get("findings") or output,
            )
            status = completion_status(self.workspace)
            if "alex_validation" in status["missing"] and current_build(self.workspace):
                # The reviewer may have corrected checks; re-run implementation evidence.
                self.check_candidate(f"revalidate-{round}")
                status = completion_status(self.workspace)
            if status["ready"]:
                return
            if round == MAX_REVIEW_REPAIRS:
                raise HarnessFailure("validation")
            review = self.workspace["review"]
            if review and not review["accepted"]:
                self.repair(f"review-repair-{round}", [review["findings"]])
                self.check_candidate(f"review-verify-{round}")

    def deliver(self) -> dict:
        if not completion_status(self.workspace)["ready"]:
            raise HarnessFailure("validation")
        candidate = (self.workspace["candidate"] or {}).get("summary", "")
        findings = (self.workspace["review"] or {}).get("findings", "")
        summary = "\n\n".join(part for part in (candidate, findings) if part)[:20_000]
        return {
            "source": self.workspace["source"],
            "html": self.workspace["html"],
            "checks": self.workspace["checks"],
            "summary": summary or "Accepted.",
        }


class DeliveryState(BaseModel):
    # CrewAI requires a state id; this Flow is never persisted (DBOS owns recovery).
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    route: str = "plan"


class DeliveryFlow(Flow[DeliveryState]):
    """Native CrewAI Flow: code-owned routing, bounded loops, single artifact writer."""

    _skip_auto_memory: bool = True
    initial_state: type[DeliveryState] = DeliveryState
    _delivery: Any = PrivateAttr(default=None)
    _failure: Any = PrivateAttr(default=None)
    _result: Any = PrivateAttr(default=None)

    def __init__(self, delivery: Delivery):
        super().__init__(suppress_flow_events=True, tracing=False)
        self._delivery = delivery

    def _guard(self, operation: Callable[[], Any]) -> Any:
        # Failures must not cross the Flow's asyncio/thread boundary as cancellations;
        # they are re-raised unchanged on the caller's thread after kickoff.
        if self._failure is not None:
            return None
        try:
            return operation()
        except BaseException as error:
            self._failure = error
            return None

    @start()
    def coordinate(self) -> None:
        self.state.route = self._guard(self._delivery.route) or "plan"

    @router(coordinate)
    def dispatch(self) -> Literal["route_plan", "route_quick_edit", "halt"]:
        # Labels differ from method names: a string trigger also matches a method.
        if self._failure is not None:
            return "halt"
        return "route_quick_edit" if self.state.route == "quick_edit" else "route_plan"

    @listen("route_plan")
    def plan(self) -> None:
        self._guard(self._delivery.plan)

    @listen(plan)
    def build(self) -> None:
        self._guard(lambda: self._delivery.implement("builder", "build", "Implement the plan"))

    @listen("route_quick_edit")
    def quick_edit(self) -> None:
        self._guard(
            lambda: self._delivery.implement("quick_edit", "quick-edit", "Apply the quick edit")
        )

    @listen(or_(build, quick_edit))
    def verify(self) -> None:
        self._guard(self._delivery.verify)

    @listen(verify)
    def review(self) -> None:
        self._guard(self._delivery.review)

    @listen(review)
    def deliver(self) -> None:
        self._result = self._guard(self._delivery.deliver)

    def execute(self) -> dict:
        self.kickoff()
        if self._failure is not None:
            raise self._failure
        if self._result is None:
            raise HarnessFailure("internal")
        return self._result


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

    def model(effort: str | None = None) -> ObservedOpenAI:
        llm = ObservedOpenAI(
            model=settings.model,
            reasoning_effort=effort,
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

    flow = DeliveryFlow(Delivery(runtime, model))
    try:
        with runtime.scoped("run", "mike"):
            emit("agent_start", {"id": "mike", "name": "Mike"})
        result = flow.execute()
        runtime.check()
        with runtime.scoped("run-end", "mike"):
            emit("agent_end", {"id": "mike", "name": "Mike"})
        return result
    finally:
        for llm in llms:
            if llm._client is not None:
                llm._client.close()
