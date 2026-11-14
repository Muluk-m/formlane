"""Strict private selection evidence; browser hints never authorize source locations."""

import base64
import binascii
import io
import json
from datetime import datetime
from typing import Annotated, Literal

from PIL import Image, UnidentifiedImageError
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

MAX_METADATA_BYTES = 64 * 1024
MAX_IMAGE_BYTES = 2_000_000
MAX_IMAGE_PIXELS = 16_000_000
MAX_SELECTION_REQUEST_BYTES = 3 * 1024 * 1024
ATTRIBUTES = frozenset(
    {
        "id",
        "class",
        "role",
        "aria-label",
        "aria-labelledby",
        "aria-describedby",
        "aria-expanded",
        "aria-pressed",
        "aria-selected",
        "aria-checked",
        "aria-disabled",
        "title",
        "alt",
        "type",
        "name",
        "placeholder",
        "disabled",
        "checked",
        "tabindex",
    }
)
STYLES = frozenset(
    {
        "display",
        "visibility",
        "position",
        "color",
        "background-color",
        "font-family",
        "font-size",
        "font-weight",
        "line-height",
        "text-align",
        "text-decoration",
        "width",
        "height",
        "margin",
        "padding",
        "border",
        "border-radius",
        "opacity",
        "overflow",
        "overflow-x",
        "overflow-y",
        "z-index",
        "transform",
        "flex-direction",
        "align-items",
        "justify-content",
        "gap",
        "grid-template-columns",
    }
)
Identifier = Annotated[str, StringConstraints(min_length=1, max_length=128)]
Hash = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Uuid = Annotated[
    str,
    StringConstraints(
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    ),
]
Tag = Annotated[str, StringConstraints(pattern=r"^[a-zA-Z][a-zA-Z0-9:_-]{0,63}$")]
Coordinate = Annotated[float, Field(ge=-10_000_000, le=10_000_000, allow_inf_nan=False)]
Dimension = Annotated[float, Field(ge=0, le=1_000_000, allow_inf_nan=False)]
ShortText = Annotated[str, StringConstraints(max_length=500)]


class EvidenceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class SourceLocation(EvidenceModel):
    path: Annotated[str, StringConstraints(min_length=1, max_length=240)]
    startLine: Annotated[int, Field(ge=1)]
    startColumn: Annotated[int, Field(ge=1)]
    endLine: Annotated[int, Field(ge=1)]
    endColumn: Annotated[int, Field(ge=1)]
    tagName: Tag


class SourceManifest(EvidenceModel):
    instrumentationVersion: Identifier
    sourceHash: Hash
    canonicalArtifactHash: Hash
    editorArtifactHash: Hash
    entries: Annotated[dict[Identifier, SourceLocation], Field(max_length=4096)]


class Rect(EvidenceModel):
    x: Coordinate
    y: Coordinate
    width: Dimension
    height: Dimension


class Viewport(EvidenceModel):
    width: Annotated[float, Field(gt=0, le=16384)]
    height: Annotated[float, Field(gt=0, le=16384)]


class Scroll(EvidenceModel):
    x: Coordinate
    y: Coordinate


class Ancestor(EvidenceModel):
    nodeId: Identifier
    sourceId: Identifier | None
    tagName: Tag
    label: ShortText


class Instance(EvidenceModel):
    label: ShortText
    context: ShortText


class ElementContext(EvidenceModel):
    nodeId: Identifier
    sourceId: Identifier | None
    tagName: Tag
    role: Annotated[str, StringConstraints(max_length=100)] | None
    text: Annotated[str, StringConstraints(max_length=2000)]
    attributes: Annotated[dict[str, ShortText], Field(max_length=len(ATTRIBUTES))]
    styles: Annotated[dict[str, ShortText], Field(max_length=len(STYLES))]
    selector: Annotated[str, StringConstraints(max_length=1000)]
    ancestors: Annotated[list[Ancestor], Field(max_length=12)]
    rects: Annotated[list[Rect], Field(max_length=32)]
    viewport: Viewport
    scroll: Scroll
    instance: Instance

    @model_validator(mode="after")
    def safe_fields(self):
        if set(self.attributes) - ATTRIBUTES or set(self.styles) - STYLES:
            raise ValueError("Selection contains unsupported attributes or styles.")
        if self.tagName.lower() in {
            "script",
            "style",
            "meta",
            "link",
            "head",
            "title",
            "noscript",
            "template",
        }:
            raise ValueError("Selection must describe rendered content.")
        if self.attributes.get("type", "").lower() == "password" and self.text:
            raise ValueError("Password content cannot be attached.")
        return self


class ElementEvidence(EvidenceModel):
    kind: Literal["element"]
    element: ElementContext


class RegionEvidence(EvidenceModel):
    kind: Literal["region"]
    rectangle: Rect
    elements: Annotated[list[ElementContext], Field(max_length=32)]
    focus: ElementContext | None
    viewport: Viewport
    scroll: Scroll
    truncated: bool

    @model_validator(mode="after")
    def distinct_members(self):
        nodes = {item.nodeId: item for item in self.elements}
        if len(nodes) != len(self.elements):
            raise ValueError("Region members must be distinct runtime instances.")
        if self.focus is not None:
            focus = self.focus
            member = nodes.get(focus.nodeId)
            if member is not None and (member.sourceId, member.tagName) != (
                focus.sourceId,
                focus.tagName,
            ):
                raise ValueError("Region focus contradicts a member's source identity.")
            area = self.rectangle
            if (
                focus.viewport != self.viewport
                or focus.scroll != self.scroll
                or not any(
                    rect.width > 0
                    and rect.height > 0
                    and rect.x < area.x + area.width
                    and rect.x + rect.width > area.x
                    and rect.y < area.y + area.height
                    and rect.y + rect.height > area.y
                    for rect in focus.rects
                )
            ):
                raise ValueError("Region focus must intersect the same viewport-local area.")
        if self.rectangle.width <= 0 or self.rectangle.height <= 0:
            raise ValueError("Region must have positive area.")
        return self


class SelectionImage(EvidenceModel):
    # A browser cannot certify a privileged server observation.
    provenance: Literal["client-captured", "dom-approximation"]
    mimeType: Literal["image/png", "image/jpeg", "image/webp"]
    base64: Annotated[str, StringConstraints(min_length=4, max_length=2_666_668)]
    width: Annotated[int, Field(ge=1, le=16384)]
    height: Annotated[int, Field(ge=1, le=16384)]

    @model_validator(mode="after")
    def valid_pixels(self):
        try:
            pixels = base64.b64decode(self.base64, validate=True)
            if (
                len(pixels) > MAX_IMAGE_BYTES
                or base64.b64encode(pixels).decode("ascii") != self.base64
            ):
                raise ValueError("Invalid image encoding or size.")
            with Image.open(io.BytesIO(pixels), formats=["PNG", "JPEG", "WEBP"]) as image:
                if (
                    Image.MIME.get(image.format) != self.mimeType
                    or image.size != (self.width, self.height)
                    or image.width * image.height > MAX_IMAGE_PIXELS
                    or getattr(image, "n_frames", 1) != 1
                ):
                    raise ValueError("Image type, dimensions or frame count do not match.")
                image.verify()
            # verify checks container integrity; load also detects truncated pixel data.
            with Image.open(io.BytesIO(pixels), formats=["PNG", "JPEG", "WEBP"]) as image:
                image.load()
        except (
            ValueError,
            OSError,
            SyntaxError,
            binascii.Error,
            UnidentifiedImageError,
            Image.DecompressionBombError,
        ) as error:
            raise ValueError(
                "Invalid selection image (2 MB, 16 million pixels maximum)."
            ) from error
        return self


class Reproduction(EvidenceModel):
    steps: Annotated[list[ShortText], Field(max_length=20)]
    clock: Annotated[str, StringConstraints(max_length=40)] | None = None
    seed: Annotated[int, Field(ge=0, le=4_294_967_295)] | None = None

    @field_validator("clock")
    @classmethod
    def valid_clock(cls, value):
        if value is not None:
            parsed = datetime.fromisoformat(value)
            if parsed.tzinfo is None:
                raise ValueError("Reproduction clock requires a timezone.")
        return value


class SelectionSubmission(EvidenceModel):
    versionId: Uuid
    sourceHash: Hash
    canonicalArtifactHash: Hash
    editorArtifactHash: Hash
    instrumentationVersion: Identifier
    sessionId: Identifier
    documentId: Identifier
    evidence: Annotated[ElementEvidence | RegionEvidence, Field(discriminator="kind")]
    image: SelectionImage | None = None
    reproduction: Reproduction | None = None

    @model_validator(mode="after")
    def metadata_budget(self):
        data = self.model_dump(exclude_unset=True)
        if data.get("image"):
            data["image"].pop("base64")

        # PostgreSQL JSONB rejects NUL and unpaired surrogates. Enforce UTF-16
        # character budgets shared with the browser, including astral characters.
        def check_strings(value, key=""):
            if isinstance(value, str):
                limits = {
                    "text": 2000,
                    "selector": 1000,
                    "label": 500,
                    "context": 500,
                    "attributes": 500,
                    "styles": 500,
                    "steps": 500,
                    "role": 100,
                    "nodeId": 128,
                    "sourceId": 128,
                    "sessionId": 128,
                    "documentId": 128,
                    "instrumentationVersion": 128,
                    "tagName": 64,
                }
                if "\0" in value or len(value.encode("utf-16-le")) // 2 > limits.get(key, 4000):
                    raise ValueError("Selection text exceeds its limit.")
            elif isinstance(value, dict):
                for name, item in value.items():
                    check_strings(name)
                    check_strings(item, key if key in {"attributes", "styles"} else name)
            elif isinstance(value, list):
                for item in value:
                    check_strings(item, key)

        check_strings(data)
        if (
            len(
                json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode(
                    "utf-8"
                )
            )
            > MAX_METADATA_BYTES
        ):
            raise ValueError("Selection metadata exceeds 64 KiB.")
        return self


def bind_selection(submission: SelectionSubmission, manifest: dict) -> dict:
    """Resolve only compiler IDs; never consume a client path or source range."""
    data = submission.model_dump(exclude_unset=True)
    for key in (
        "sourceHash",
        "canonicalArtifactHash",
        "editorArtifactHash",
        "instrumentationVersion",
    ):
        if data[key] != manifest[key]:
            raise ValueError("Selection artifact identity does not match its version.")
    evidence = submission.evidence
    elements = [evidence.element] if isinstance(evidence, ElementEvidence) else evidence.elements
    if isinstance(evidence, RegionEvidence) and evidence.focus is not None:
        elements = [*elements, evidence.focus]
    resolutions = []
    resolved = set()
    for element in elements:
        for hint in [element, *element.ancestors]:
            if hint.sourceId is not None:
                location = manifest["entries"].get(hint.sourceId)
                if location is None or location["tagName"].lower() != hint.tagName.lower():
                    raise LookupError("Invalid compiler source identity.")
        if element.nodeId in resolved:
            continue
        resolved.add(element.nodeId)
        if element.sourceId is None:
            resolutions.append(
                {
                    "nodeId": element.nodeId,
                    "status": "unmapped",
                    "reason": "No compiler source attribution.",
                }
            )
        else:
            location = manifest["entries"][element.sourceId]
            # Source locations are copied from the trusted compiler, never the browser.
            resolutions.append(
                {
                    "nodeId": element.nodeId,
                    "status": "mapped",
                    "sourceId": element.sourceId,
                    "location": location,
                }
            )
    return {**data, "sourceResolutions": resolutions}


def selection_summary(selection: dict | None) -> dict | None:
    if selection is None:
        return None
    evidence = selection["evidence"]
    element = evidence.get("element")
    return {
        "selectionId": selection["selectionId"],
        "kind": evidence["kind"],
        "tagName": element["tagName"] if element else None,
        "memberCount": 1 if element else len(evidence["elements"]),
        "hasImage": bool(selection.get("image")),
    }
