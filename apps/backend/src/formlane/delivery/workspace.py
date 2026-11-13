"""Workspace, acceptance evidence and durable operation journal for one run."""

from __future__ import annotations

import copy
import hashlib
import json
import re
import uuid
from concurrent.futures import CancelledError
from types import MappingProxyType
from typing import Any, Callable

from ..compiler import compile_project
from ..project import artifact_hash, create_source, source_hash, validate_source
from ..validator import inspect_artifact, validate_artifact, validate_checks
from .errors import HarnessFailure, RuntimeAbort
from .schemas import Edit

FLOW_VERSION = "flow-v1"
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
    review = workspace["review"]
    if (
        not build
        or not review
        or not review["accepted"]
        or any(review.get(key) != build[key] for key in ("sourceHash", "artifactHash"))
        or review.get("checksHash") != check_hash
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
    """Workspace state, acceptance evidence and durable operations for one run."""

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
        }

    def begin_model_call(self, scope: dict) -> None:
        self.check()

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
            independentValidation=None,
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

    def read_workspace(self, args: dict) -> dict:
        self.check()
        return self.workspace_info()

    def read_previous_file(self, args: dict) -> dict:
        self.check()
        if not self.previous or args["path"] not in self.previous["files"]:
            raise ValueError("File does not exist in the saved baseline.")
        return {"path": args["path"], "content": self.previous["files"][args["path"]]}

    def read_review_files(self, args: dict) -> dict:
        self.check()
        current = self.workspace
        source = current["source"]
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

    def choose_route(self, args: dict) -> dict:
        self.check()
        self.workspace["route"] = args["route"]
        return dict(args)

    def submit_plan(self, args: dict) -> dict:
        self.check()
        current = self.workspace
        if current["plan"] is not None:
            raise ValueError("The plan was already submitted.")
        checks = validate_checks(with_smoke(args["checks"]))
        require_clock_coverage(checks)
        if not current["source"]:
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

    def set_acceptance_checks(self, args: dict) -> dict:
        self.check()
        current = self.workspace
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

    def record_review(self, args: dict) -> dict:
        self.check()
        current = self.workspace
        built = current_build(current)
        changed = {
            item["path"]
            for item in source_changes(current["source"], self.previous)
            if item["status"] != "unchanged"
        }
        independent = current["independentValidation"]
        if args["accepted"] and (
            not built
            or not independent
            or independent["artifactHash"] != built["artifactHash"]
            or independent["checksHash"] != checks_hash(current["checks"])
            or not changed.issubset(current["reviewedPaths"])
        ):
            raise ValueError(
                "Acceptance requires your own passing current-artifact browser validation and inspection of every changed baseline file."
            )
        current["review"] = {
            **args,
            "sourceHash": built["sourceHash"] if built else "",
            "artifactHash": built["artifactHash"] if built else "",
            "checksHash": checks_hash(current["checks"]),
        }
        return {**current["review"], "completion": completion_status(current)}

    def require_source(self) -> dict:
        self.check()
        source = self.workspace["source"]
        if not source:
            raise ValueError("No project exists yet; the plan initializes it.")
        return source

    def read_file(self, args: dict) -> dict:
        source = self.require_source()
        if args["path"] not in source["files"]:
            raise ValueError("File does not exist.")
        return {"path": args["path"], "content": source["files"][args["path"]]}

    def source_candidate(self) -> dict:
        source = self.require_source()
        return {"template": source["template"], "files": dict(source["files"])}

    def save_source(self, candidate: dict, path: str) -> dict:
        self.invalidate(candidate)
        return {
            "path": path,
            "revision": self.workspace["revision"],
            "message": "Source changed. Build before submitting.",
        }

    def write_file(self, args: dict) -> dict:
        candidate = self.source_candidate()
        path = args["path"]
        candidate["files"][path] = args["content"]
        return self.save_source(candidate, path)

    def edit_file(self, args: dict) -> dict:
        candidate = self.source_candidate()
        path = args["path"]
        if path not in candidate["files"]:
            raise ValueError("File does not exist. Read workspace first.")
        candidate["files"][path] = apply_file_edits(candidate["files"][path], args["edits"])
        return self.save_source(candidate, path)

    def delete_file(self, args: dict) -> dict:
        candidate = self.source_candidate()
        path = args["path"]
        if path not in candidate["files"]:
            raise ValueError("File does not exist. Read workspace first.")
        del candidate["files"][path]
        return self.save_source(candidate, path)

    def build_project(self, args: dict) -> dict:
        source = self.require_source()
        current = self.workspace
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

    def search_files(self, args: dict) -> dict:
        source = self.require_source()
        return search_source(source, args["query"], args["ignore_case"])

    def inspect_preview(self, args: dict) -> dict:
        self.require_source()
        current = self.workspace
        if not current_build(current):
            raise ValueError("Build current source successfully before inspecting it.")
        return inspect_artifact(current["html"], args, self.settings, self.cancelled)

    def submit_candidate(self, args: dict) -> dict:
        self.require_source()
        current = self.workspace
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

    def validate_preview(self, args: dict) -> dict:
        self.require_source()
        current = self.workspace
        role = self.scope["role"]
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

    def invoke(self, operation: Callable[[dict], dict], args: dict) -> dict:
        """Run one operation as a durable step; replay restores its workspace."""
        self.check()
        name = operation.__name__
        scope = self.scope
        index = scope["tool_index"]
        scope["tool_index"] += 1
        step = f"{scope['path']}/tool-{index}-{name}"

        def perform() -> dict:
            self.emit("tool_start", {"id": step, "name": name, "agent": scope["role"]})
            try:
                output = operation(args)
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
            return {"output": output, "workspace": copy.deepcopy(self.workspace), "args": args}

        try:
            saved = self.durable.run(step, perform)
        except Exception as error:
            raise RuntimeAbort(error) from None
        if saved["args"] != args:
            raise HarnessFailure("internal")
        self.workspace = copy.deepcopy(saved["workspace"])
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
        return saved["output"]

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

