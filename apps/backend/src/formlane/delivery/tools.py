"""Concrete CrewAI tools and ordered, explicitly declared stage permissions."""

from __future__ import annotations

import json
from typing import Any, Callable

from crewai.tools import BaseTool
from pydantic import BaseModel, PrivateAttr

from .schemas import (
    ChecksArgs,
    EditArgs,
    InspectArgs,
    NoArgs,
    PathArgs,
    PlanArgs,
    ReviewArgs,
    ReviewFilesArgs,
    RouteArgs,
    SearchArgs,
    SubmitArgs,
    WriteArgs,
)
from .workspace import Runtime

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


class WorkspaceTool(BaseTool):
    """Shared argument, budget and durable invocation boundary; no evidence writes."""

    _runtime: Runtime = PrivateAttr()

    def __init__(self, runtime: Runtime):
        super().__init__(cache_function=lambda *_: False)
        self._runtime = runtime

    def execute(self, operation: Callable[[dict], dict], kwargs: dict) -> str:
        runtime = self._runtime
        runtime.check()
        args = self.args_schema.model_validate(kwargs).model_dump()
        role = runtime.scope["role"]
        limit = TOOL_BUDGETS.get(role, {}).get(self.name)
        uses = runtime.scope["uses"]
        if limit is not None and uses.get(self.name, 0) >= limit:
            # Deterministic on replay: the same cached model calls hit the same count.
            return json.dumps(
                {
                    "error": f"{self.name} budget of {limit} for this stage is used up. {BUDGET_NEXT[role]}"
                }
            )
        uses[self.name] = uses.get(self.name, 0) + 1
        return json.dumps(runtime.invoke(operation, args), ensure_ascii=False)


class ReadWorkspace(WorkspaceTool):
    name: str = "read_workspace"
    description: str = "Read the plan, checks, source inventory, baseline changes, request and evidence."
    args_schema: type[BaseModel] = NoArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.read_workspace, kwargs)


class ReadPreviousFile(WorkspaceTool):
    name: str = "read_previous_file"
    description: str = "Read a file from the immutable saved application baseline."
    args_schema: type[BaseModel] = PathArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.read_previous_file, kwargs)


class ReadFile(WorkspaceTool):
    name: str = "read_file"
    description: str = "Read the exact current file before editing."
    args_schema: type[BaseModel] = PathArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.read_file, kwargs)


class ReadReviewFiles(WorkspaceTool):
    name: str = "read_review_files"
    description: str = (
        "Read current and immutable baseline content together for related paths, including deletions."
    )
    args_schema: type[BaseModel] = ReviewFilesArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.read_review_files, kwargs)


class ChooseRoute(WorkspaceTool):
    name: str = "choose_route"
    description: str = "Route this follow-up to quick_edit or plan."
    args_schema: type[BaseModel] = RouteArgs
    result_as_answer: bool = True

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.choose_route, kwargs)


class SubmitPlan(WorkspaceTool):
    name: str = "submit_plan"
    description: str = (
        "Submit the brief, criteria, architecture, template and acceptance checks once. "
        "Initializes a new project from the template."
    )
    args_schema: type[BaseModel] = PlanArgs
    result_as_answer: bool = True

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.submit_plan, kwargs)


class WriteFile(WorkspaceTool):
    name: str = "write_file"
    description: str = (
        "Create or replace a source file. Supply path before content. package.json is protected."
    )
    args_schema: type[BaseModel] = WriteArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.write_file, kwargs)


class EditFile(WorkspaceTool):
    name: str = "edit_file"
    description: str = "Atomically apply 1–8 unique literal edits; preserve unrelated source."
    args_schema: type[BaseModel] = EditArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.edit_file, kwargs)


class DeleteFile(WorkspaceTool):
    name: str = "delete_file"
    description: str = "Delete obsolete source. Required files and package.json remain protected."
    args_schema: type[BaseModel] = PathArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.delete_file, kwargs)


class BuildProject(WorkspaceTool):
    name: str = "build_project"
    description: str = (
        "Compile current source with the trusted compiler; generated scripts/configs never execute."
    )
    args_schema: type[BaseModel] = NoArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.build_project, kwargs)


class SubmitCandidate(WorkspaceTool):
    name: str = "submit_candidate"
    description: str = (
        "Submit the current build after validate_preview passes; if it fails only because "
        "checks are wrong, name them in check_defects. Ends your turn."
    )
    args_schema: type[BaseModel] = SubmitArgs
    result_as_answer: bool = True

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.submit_candidate, kwargs)


class InspectPreview(WorkspaceTool):
    name: str = "inspect_preview"
    description: str = (
        "Observe the current build in the sandboxed browser: accessibility tree, console, "
        "page errors and document width, optionally after actions, viewport and clock. "
        "Debugging only; not acceptance evidence."
    )
    args_schema: type[BaseModel] = InspectArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.inspect_preview, kwargs)


class SearchFiles(WorkspaceTool):
    name: str = "search_files"
    description: str = "Find a literal text in current source files; returns path, line and text."
    args_schema: type[BaseModel] = SearchArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.search_files, kwargs)


class SetAcceptanceChecks(WorkspaceTool):
    name: str = "set_acceptance_checks"
    description: str = (
        "Replace the COMPLETE declarative check set (smoke check is added automatically)."
    )
    args_schema: type[BaseModel] = ChecksArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.set_acceptance_checks, kwargs)


class ValidatePreview(WorkspaceTool):
    name: str = "validate_preview"
    description: str = (
        "Run the acceptance checks in the sandboxed browser against the current build. "
        "Failures return actual values; fix and rerun."
    )
    args_schema: type[BaseModel] = NoArgs

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.validate_preview, kwargs)


class RecordReview(WorkspaceTool):
    name: str = "record_review"
    description: str = (
        "Record the independent verdict; acceptance requires your own passing validation. Ends your turn."
    )
    args_schema: type[BaseModel] = ReviewArgs
    result_as_answer: bool = True

    def _run(self, **kwargs: Any) -> str:
        return self.execute(self._runtime.record_review, kwargs)


# Tuple order is the provider-visible order. Baseline-dependent permissions have
# explicit initial/follow-up variants rather than filtering tools by operation name.
ROUTER_TOOLS = (ChooseRoute,)
PLANNER_TOOLS = (ReadWorkspace, SubmitPlan)
FOLLOW_UP_PLANNER_TOOLS = (ReadWorkspace, ReadPreviousFile, ReadFile, SubmitPlan)
EDITING_TOOLS = (
    ReadFile,
    SearchFiles,
    WriteFile,
    EditFile,
    DeleteFile,
    BuildProject,
    InspectPreview,
    ValidatePreview,
)
BUILDER_TOOLS = (ReadWorkspace, *EDITING_TOOLS, SubmitCandidate)
FOLLOW_UP_BUILDER_TOOLS = (ReadWorkspace, ReadPreviousFile, *EDITING_TOOLS, SubmitCandidate)
QUICK_EDIT_TOOLS = (ReadWorkspace, *EDITING_TOOLS, SetAcceptanceChecks, SubmitCandidate)
FOLLOW_UP_QUICK_EDIT_TOOLS = (
    ReadWorkspace,
    ReadPreviousFile,
    *EDITING_TOOLS,
    SetAcceptanceChecks,
    SubmitCandidate,
)
REVIEWER_TOOLS = (
    ReadWorkspace,
    ReadReviewFiles,
    SearchFiles,
    InspectPreview,
    SetAcceptanceChecks,
    ValidatePreview,
    RecordReview,
)
STAGE_TOOLSETS = {
    "router": (ROUTER_TOOLS, ROUTER_TOOLS),
    "planner": (PLANNER_TOOLS, FOLLOW_UP_PLANNER_TOOLS),
    "builder": (BUILDER_TOOLS, FOLLOW_UP_BUILDER_TOOLS),
    "quick_edit": (QUICK_EDIT_TOOLS, FOLLOW_UP_QUICK_EDIT_TOOLS),
    "repair": (BUILDER_TOOLS, FOLLOW_UP_BUILDER_TOOLS),
    "reviewer": (REVIEWER_TOOLS, REVIEWER_TOOLS),
}


def tools_for_stage(runtime: Runtime, kind: str) -> list[BaseTool]:
    from .configuration import get_stage_config

    initial, follow_up = STAGE_TOOLSETS[get_stage_config(kind).tool_set]
    return [tool(runtime) for tool in (follow_up if runtime.previous else initial)]
