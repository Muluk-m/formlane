"""Native CrewAI hierarchical team with granular DBOS model/tool replay."""

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
from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, field_validator, model_validator

from .compiler import compile_project
from .model_stream import ObservedOpenAI, RuntimeAbort
from .project import artifact_hash, create_source, is_project_path, source_hash, validate_source
from .prompts import (
    ITERATION_INSTRUCTIONS,
    MANAGER_INSTRUCTIONS,
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


class ChecksArgs(NoArgs):
    checks: list[BrowserCheck] = Field(min_length=2, max_length=16)


class ReviewArgs(NoArgs):
    accepted: bool
    findings: str = Field(min_length=1, max_length=6000)


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


def completion_status(workspace: dict) -> dict:
    build = current_build(workspace)
    missing = []
    if not build:
        missing.append("current_build")
    implementation = workspace["implementationValidation"]
    check_hash = checks_hash(workspace["checks"])
    if (
        not build
        or not implementation
        or any(implementation.get(key) != build[key] for key in ("sourceHash", "artifactHash"))
    ):
        missing.append("alex_validation")
    report = workspace["report"]
    if (
        not build
        or not report
        or not report["valid"]
        or report["artifactHash"] != build["artifactHash"]
        or workspace["validatedBy"] != "david"
    ):
        missing.append("david_validation")
    review = workspace["review"]
    if (
        not build
        or not review
        or not review["accepted"]
        or any(review.get(key) != build[key] for key in ("sourceHash", "artifactHash"))
        or review.get("checksHash") != check_hash
    ):
        missing.append("david_acceptance")
    return {
        "ready": not missing,
        "missing": missing,
        "nextRole": "bob"
        if not workspace["source"]
        else "alex"
        if "alex_validation" in missing
        else "david"
        if missing
        else "complete",
    }


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
        self.workspace = {
            "brief": "",
            "architecture": "",
            "source": copy.deepcopy(previous),
            "html": "",
            "build": None,
            "checks": [],
            "report": None,
            "validatedBy": None,
            "implementationValidation": None,
            "review": None,
            "revision": 0,
            "reviewedPaths": [],
            "implementationPasses": 0,
        }
        self.delegations = 0
        self.live_delegations: set[str] = set()
        self.scope = self.new_scope("crew-v1/manager", "mike")

    def new_scope(self, path: str, role: str) -> dict:
        return {
            "path": path,
            "role": role,
            "message_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{self.context['runId']}:{path}")),
            "llm_index": 0,
            "tool_index": 0,
            "mutated": False,
        }

    def begin_model_call(self, scope: dict) -> None:
        self.check()
        if scope["role"] == "mike" or scope["path"] in self.live_delegations:
            return
        if len(self.live_delegations) >= 8:
            raise HarnessFailure("step_limit")
        self.live_delegations.add(scope["path"])

    def check(self) -> None:
        if self.cancelled():
            raise CancelledError()

    def clear_evidence(self) -> None:
        self.workspace.update(
            html="",
            build=None,
            report=None,
            validatedBy=None,
            implementationValidation=None,
            review=None,
            reviewedPaths=[],
        )

    def invalidate(self, source: dict) -> None:
        validate_source(source)
        if self.scope["role"] == "alex" and not self.scope["mutated"]:
            if self.workspace["implementationPasses"] >= 2:
                raise ValueError(
                    "Implementation/repair limit reached. Only unchanged-source validation remains available."
                )
            self.workspace["implementationPasses"] += 1
            self.scope["mutated"] = True
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
        if name == "set_acceptance_checks":
            checks = validate_checks(args["checks"])
            current.update(checks=checks, report=None, validatedBy=None, review=None)
            return {"checks": len(checks), "revision": current["revision"]}
        if name == "record_review":
            built = current_build(current)
            changed = {
                item["path"]
                for item in source_changes(source, self.previous)
                if item["status"] != "unchanged"
            }
            if args["accepted"] and (
                not built
                or not current["report"]
                or not current["report"]["valid"]
                or current["validatedBy"] != "david"
                or current["report"]["artifactHash"] != built["artifactHash"]
                or not changed.issubset(current["reviewedPaths"])
            ):
                raise ValueError(
                    "Acceptance requires independent current-artifact browser validation and inspection of every changed baseline file."
                )
            current["review"] = {
                **args,
                "sourceHash": built["sourceHash"] if built else "",
                "artifactHash": built["artifactHash"] if built else "",
                "checksHash": checks_hash(current["checks"]),
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
                "message": "Source changed. Build and independently validate before acceptance.",
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
        if name == "validate_preview":
            built = current_build(current)
            if not built:
                raise ValueError("Build current source successfully before validation.")
            checks = validate_checks(current["checks"])
            report = validate_artifact(current["html"], checks, self.settings, self.cancelled)
            self.check()
            if report["artifactHash"] != built["artifactHash"]:
                raise ValueError("Browser report does not match the current artifact.")
            current.update(report=report, validatedBy=role, review=None)
            if role == "alex":
                current["implementationValidation"] = dict(built) if report["valid"] else None
            self.emit("validation", report)
            return report
        raise ValueError("Unsupported source operation.")

    def tool(
        self, name: str, description: str, schema: type[BaseModel], terminal: bool = False
    ) -> Tool:
        def execute(**kwargs: Any) -> str:
            self.check()
            args = schema.model_validate(kwargs).model_dump()
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
                    {"revision": self.workspace["revision"]} if name.startswith("read_") else output
                )
                self.emit(
                    "tool_end", {"id": step, "name": name, "agent": scope["role"], "output": public}
                )
                return {
                    "output": output,
                    "workspace": copy.deepcopy(self.workspace),
                    "mutated": scope["mutated"],
                    "args": args,
                }

            try:
                saved = self.durable.run(step, perform)
            except Exception as error:
                raise RuntimeAbort(error) from None
            if saved["args"] != args:
                raise HarnessFailure("internal")
            self.workspace = copy.deepcopy(saved["workspace"])
            scope["mutated"] = saved["mutated"]
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
            return json.dumps(saved["output"], ensure_ascii=False)

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
                "Read exact source inventory, baseline changes, request, build and completion requirements.",
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
            "initialize_project": (
                "Choose and create vanilla or react-ts source. Existing projects cannot be reset.",
                InitializeArgs,
            ),
            "write_file": (
                "Create or replace a source file. Supply path before content. package.json is protected.",
                WriteArgs,
            ),
            "edit_file": (
                "Atomically apply 1–8 unique literal edits; preserve unrelated source and existing checks.",
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
            "set_acceptance_checks": (
                "Replace declarative checks, clearing stale validation and review. "
                + CHECK_INSTRUCTIONS,
                ChecksArgs,
            ),
            "validate_preview": (
                "Run real isolated browser checks on the current source build; Alex returns immediately.",
                NoArgs,
            ),
            "record_review": (
                "Record independent current-source review; acceptance requires your own passing browser evidence.",
                ReviewArgs,
            ),
        }
        names = {
            "emma": ["read_workspace", "read_previous_file"],
            "bob": ["read_workspace", "read_previous_file", "read_file", "initialize_project"],
            "alex": [
                "read_workspace",
                "read_previous_file",
                "initialize_project",
                "read_file",
                "write_file",
                "edit_file",
                "delete_file",
                "build_project",
                "set_acceptance_checks",
                "validate_preview",
            ],
            "david": [
                "read_workspace",
                "read_review_files",
                "set_acceptance_checks",
                "validate_preview",
                "record_review",
            ],
        }[role]
        return [
            self.tool(
                name,
                *available[name],
                terminal=(role == "alex" and name == "validate_preview")
                or (role == "david" and name == "record_review"),
            )
            for name in names
            if self.previous or name != "read_previous_file"
        ]

    def delegate(self, agent: DurableAgent, task: Task, context: str | None, tools: Any) -> str:
        self.check()
        index = self.delegations
        self.delegations += 1
        role = agent._role_id
        step = f"crew-v1/delegate-{index}-{role}"
        parent_scope = self.scope
        baseline = copy.deepcopy(self.workspace)

        def execute() -> dict:
            self.workspace = copy.deepcopy(baseline)
            self.scope = self.new_scope(step, role)
            message_id = self.scope["message_id"]
            self.emit("project_reset", {"source": self.workspace["source"]})
            self.emit(
                "tool_start",
                {
                    "id": step,
                    "name": f"delegate_{role}",
                    "agent": "mike",
                    "childAgent": role,
                    "input": task.description,
                },
            )
            self.emit("agent_start", {"id": role, "name": role.title(), "task": task.description})
            self.emit("message_start", {"id": message_id, "role": "agent", "agent": role})
            if (
                role == "alex"
                and self.workspace["report"]
                and not self.workspace["report"]["valid"]
            ):
                self.emit(
                    "repair",
                    {
                        "attempt": self.workspace["revision"] + 1,
                        "issues": self.workspace["report"]["issues"],
                    },
                )
            try:
                output = str(super(DurableAgent, agent).execute_task(task, context, tools))
                self.check()
                if role == "emma":
                    self.workspace["brief"] = output
                elif role == "bob":
                    self.workspace["architecture"] = output
                self.emit(
                    "message_done",
                    {
                        "id": message_id,
                        "role": "agent",
                        "agent": role,
                        "content": output,
                        "createdAt": int(time.time() * 1000),
                    },
                )
                self.emit("agent_end", {"id": role, "name": role.title()})
                manager_result = json.dumps(
                    {"result": output, "workspace": self.workspace_info()}, ensure_ascii=False
                )
                self.emit(
                    "tool_end",
                    {
                        "id": step,
                        "name": f"delegate_{role}",
                        "agent": "mike",
                        "childAgent": role,
                        "output": output[:3000],
                    },
                )
                return {"workspace": copy.deepcopy(self.workspace), "result": manager_result}
            finally:
                self.scope = parent_scope

        try:
            saved = self.durable.orchestrate(step, execute)
            self.workspace = copy.deepcopy(saved["workspace"])
            self.emit("project_reset", {"source": self.workspace["source"]})
            return saved["result"]
        except Exception as error:
            raise RuntimeAbort(error) from None
        finally:
            self.scope = parent_scope


class SourceExecutor(AgentExecutor):
    """Keep native tool execution ordered even if a provider ignores its flag."""

    @classmethod
    def flow_definition(cls) -> FlowDefinition:
        # CrewAI 1.15.40 only discovers decorated methods on the concrete class.
        # Reuse its native graph; methods still bind to this ordered executor.
        return AgentExecutor.flow_definition()

    def _should_parallelize_native_tool_calls(self, tool_calls: list[Any]) -> bool:
        return False


class DurableAgent(Agent):
    _runtime: Any = PrivateAttr(default=None)
    _role_id: str = PrivateAttr(default="")

    def bind(self, runtime: Runtime, role: str) -> DurableAgent:
        self._runtime, self._role_id = runtime, role
        return self

    def execute_task(self, task: Task, context: str | None = None, tools: Any = None) -> str:
        return self._runtime.delegate(self, task, context, tools)


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

    baseline_instructions = f"{ITERATION_INSTRUCTIONS}\n\n" if runtime.previous else ""
    agents = [
        DurableAgent(
            role=role.title(),
            goal=ROLE_GOALS[role],
            backstory=f"{TEAM_INSTRUCTIONS}\n\n{baseline_instructions}{ROLE_INSTRUCTIONS[role]}",
            llm=model(),
            tools=runtime.tools(role),
            allow_delegation=False,
            allow_code_execution=False,
            max_iter=48 if role == "alex" else 80 if role == "david" else 10,
            max_retry_limit=0,
            cache=False,
            verbose=False,
            checkpoint=False,
            executor_class=SourceExecutor,
        ).bind(runtime, role)
        for role in ROLE_INSTRUCTIONS
    ]
    manager = Agent(
        role="Mike",
        goal="Deliver the requested app only with current-source implementation validation and independent acceptance.",
        backstory=f"{TEAM_INSTRUCTIONS}\n\n{baseline_instructions}{MANAGER_INSTRUCTIONS}",
        llm=model(),
        allow_delegation=True,
        allow_code_execution=False,
        max_iter=24,
        max_retry_limit=0,
        cache=False,
        verbose=False,
        checkpoint=False,
        executor_class=SourceExecutor,
    )

    def acceptance(output):
        runtime.check()
        status = completion_status(runtime.workspace)
        return (True, output.raw) if status["ready"] else (False, json.dumps(status))

    task = Task(
        description=json.dumps(
            {
                "request": context["request"],
                "hasPreviousApp": bool(runtime.previous),
                "workspace": runtime.workspace_info(),
            },
            ensure_ascii=False,
        ),
        expected_output="A concise user-language summary of the accepted application. Current-source build, Alex browser validation, independent David browser validation and explicit review must all pass.",
        guardrail=acceptance,
        guardrail_max_retries=2,
    )
    crew = Crew(
        agents=agents,
        tasks=[task],
        manager_agent=manager,
        process=Process.hierarchical,
        cache=False,
        memory=False,
        planning=False,
        verbose=False,
        tracing=False,
        share_crew=False,
        checkpoint=False,
    )

    def execute() -> dict:
        emit("agent_start", {"id": "mike", "name": "Mike"})
        try:
            result = crew.kickoff()
        except Exception as error:
            if str(error).startswith("Task failed guardrail validation"):
                raise HarnessFailure("validation") from None
            raise
        runtime.check()
        if not completion_status(runtime.workspace)["ready"]:
            raise HarnessFailure("validation")
        emit("agent_end", {"id": "mike", "name": "Mike"})
        return {
            "source": runtime.workspace["source"],
            "html": runtime.workspace["html"],
            "summary": result.raw,
        }

    try:
        return execute()
    finally:
        for llm in llms:
            if llm._client is not None:
                llm._client.close()
