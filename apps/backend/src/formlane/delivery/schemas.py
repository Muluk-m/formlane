"""Strict argument models shared by delivery tools."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from ..project import is_project_path


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


class InspectionViewport(NoArgs):
    width: int = Field(ge=1, le=16384)
    height: int = Field(ge=1, le=16384)

    @model_validator(mode="after")
    def bounded_pixels(self):
        if self.width * self.height > 16_000_000:
            raise ValueError("Inspection viewport exceeds 16 million pixels.")
        return self



class Clock(NoArgs):
    now: str = Field(min_length=10, max_length=40)
    timezone: str | None = None


class BrowserCheck(NoArgs):
    name: str = Field(min_length=1, max_length=160)
    viewport: Viewport | None = None
    clock: Clock | None = None
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)
    actions: list[BrowserAction] = Field(max_length=16)
    assertion: BrowserAssertion | None = None
    assertions: list[BrowserAssertion] = Field(default_factory=list, max_length=12)


class ChecksArgs(NoArgs):
    # One slot is reserved for the harness smoke check.
    checks: list[BrowserCheck] = Field(min_length=2, max_length=15)


class StructuralChange(NoArgs):
    node_id: str = Field(min_length=1, max_length=128)
    disposition: Literal["removed", "replaced"]
    request_quote: str = Field(min_length=1, max_length=300)
    source_paths: list[str] = Field(min_length=1, max_length=8)
    justification: str = Field(min_length=1, max_length=600)
    replacement_selector: str | None = Field(default=None, min_length=1, max_length=1000)

    @model_validator(mode="after")
    def supported_change(self):
        if not self.request_quote.strip() or not self.justification.strip():
            raise ValueError("Explain the requested structural change using the original comment and inspected source.")
        if any(not is_project_path(path) for path in self.source_paths):
            raise ValueError("Use safe relative source paths.")
        if (self.disposition == "replaced") != bool(self.replacement_selector):
            raise ValueError("Only replacement changes require a replacement_selector.")
        return self


class ReviewArgs(NoArgs):
    accepted: bool
    findings: str = Field(min_length=1, max_length=6000)
    visual_evidence_ids: list[str] = Field(default_factory=list, max_length=6)
    original_scene_status: Literal["observed-context-matches", "not-reproduced"] | None = None
    scene_limitations: str | None = Field(default=None, min_length=1, max_length=2000)
    structural_changes: list[StructuralChange] = Field(default_factory=list, max_length=33)

    @field_validator("visual_evidence_ids")
    @classmethod
    def bounded_evidence_ids(cls, values: list[str]) -> list[str]:
        if any(not 1 <= len(value) <= 128 for value in values):
            raise ValueError("Visual evidence IDs must contain 1–128 characters.")
        return values


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


class IterationArgs(NoArgs):
    next_step: Literal["repair", "review"]
    instructions: str = Field(min_length=1, max_length=4000)


class RouteArgs(NoArgs):
    route: Literal["quick_edit", "plan"]
    reason: str = Field(min_length=1, max_length=600)


class SubmitArgs(NoArgs):
    summary: str = Field(min_length=1, max_length=2000)
    # Failing checks the builder believes are wrong; the reviewer owns their correction.
    check_defects: list[str] = Field(default_factory=list, max_length=16)


class InspectArgs(NoArgs):
    target: Literal["baseline", "current"] = "current"
    selection_id: str | None = Field(default=None, min_length=1, max_length=128)
    selector: str | None = Field(default=None, min_length=1, max_length=1000)
    viewport: InspectionViewport | None = None
    clock: Clock | None = None
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)
    actions: list[BrowserAction] = Field(default_factory=list, max_length=16)


class SearchArgs(NoArgs):
    query: str = Field(min_length=1, max_length=200)
    ignore_case: bool = True
