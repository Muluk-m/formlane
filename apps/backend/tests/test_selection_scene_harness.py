"""Native harness, compiler and browser contracts for selection scene assessment."""

import copy
import json
from concurrent.futures import CancelledError
from types import SimpleNamespace

import pytest
from crewai.llms.providers.openai.completion import OpenAICompletion
from openai.types.chat import ChatCompletionChunk
from test_agents import Checkpoints
from test_compiler import settings as compiler_settings

from formlane.compiler import compile_project
from formlane.delivery import execute_harness
from formlane.delivery.errors import RuntimeAbort
from formlane.project import artifact_hash, legacy_source, source_hash

ORIGINAL = """<!doctype html><html><body><h1 id="title">0</h1>
<button id="increment">Add</button><button id="neighbor">Keep me</button>
<script>let count=0; document.querySelector('#increment').onclick=()=>{
 document.querySelector('#title').textContent=String(++count);
};</script></body></html>"""


def checks(initial):
    return [
        {
            "name": "Initial label",
            "actions": [],
            "assertions": [{"kind": "text", "selector": "#title", "expected": initial}],
        },
        {
            "name": "Counting still works",
            "actions": [{"kind": "click", "selector": "#increment", "value": None}],
            "assertions": [{"kind": "text", "selector": "#title", "expected": "1"}],
        },
    ]


def element(node, tag, text):
    return {
        "nodeId": node,
        "sourceId": None,
        "selector": "#" + node,
        "tagName": tag,
        "text": text,
        "attributes": {},
        "styles": {},
        "viewport": {"width": 1280, "height": 720},
        "scroll": {"x": 0, "y": 0},
        "instance": {"label": text, "context": "Counter"},
    }


@pytest.mark.parametrize(
    "case",
    [
        "text",
        "unintended-removal",
        "requested-removal",
        "hidden-replacement",
        "clipped-replacement",
        "visible-replacement",
        "mobile-omitted-replacement",
    ],
)
def test_scene_and_structural_changes_require_explicit_independent_assessment(monkeypatch, case):
    remove_region_neighbor = case.endswith("removal")
    replacement = case.endswith("replacement")
    rejected_change = case in {
        "unintended-removal",
        "hidden-replacement",
        "clipped-replacement",
        "mobile-omitted-replacement",
    }
    settings = compiler_settings()
    settings.openai_api_key = "controlled-provider"
    settings.model = "gpt-5.4"
    settings.endpoint = "http://127.0.0.1:1/v1"
    source = legacy_source(ORIGINAL)
    baseline = compile_project(source, settings, lambda: False)
    selected = (
        element("neighbor", "button", "Keep me")
        if replacement
        else element("title", "h1", "0" if remove_region_neighbor else "3")
    )
    neighbor = element("neighbor", "button", "Keep me")
    evidence = (
        {
            "kind": "region",
            "elements": [selected, neighbor],
            "focus": selected,
            "rectangle": {"x": 0, "y": 0, "width": 400, "height": 200},
            "viewport": selected["viewport"],
            "scroll": selected["scroll"],
        }
        if remove_region_neighbor
        else {"kind": "element", "element": selected}
    )
    attachment = {
        "selectionId": "frozen",
        "versionId": "baseline",
        "projectId": "project",
        "sourceHash": source_hash(source),
        "canonicalArtifactHash": artifact_hash(baseline["html"]),
        "evidence": evidence,
        "sourceResolutions": [
            {"nodeId": item["nodeId"], "status": "unmapped", "reason": "Runtime context"}
            for item in ([selected, neighbor] if remove_region_neighbor else [selected])
        ],
        "image": None,
    }
    changed = (
        ORIGINAL.replace('<button id="neighbor">Keep me</button>', "")
        if remove_region_neighbor
        else ORIGINAL.replace('id="title">0', 'id="title">Ready')
    )
    if replacement:
        button = '<button id="replacement">Replacement</button>'
        if case == "hidden-replacement":
            button = button.replace('id="replacement"', 'id="replacement" style="display:none"')
        if case == "clipped-replacement":
            button = (
                '<div style="height:30px;overflow:hidden"><div style="height:200px"></div>'
                + button
                + "</div>"
            )
        if case == "mobile-omitted-replacement":
            button += "<style>@media(max-width:600px){#replacement{display:none}}</style>"
        changed = ORIGINAL.replace('<button id="neighbor">Keep me</button>', button)
    request = (
        "Remove the neighboring button; preserve the heading and counting."
        if case == "requested-removal"
        else "Replace the neighboring button with a button labeled Replacement; preserve counting."
        if replacement
        else "Make the heading smaller; preserve counting and the neighboring control."
        if remove_region_neighbor
        else "Change the initial heading label to Ready; preserve counting and the neighboring control."
    )
    structural = {
        "node_id": "neighbor",
        "disposition": "replaced" if replacement else "removed",
        "request_quote": "Replace the neighboring button"
        if replacement
        else "Remove the neighboring button",
        "source_paths": ["index.html"],
        "justification": "The requested neighboring control change is present in the inspected index.html diff and current native images; the heading and counting survive.",
        "replacement_selector": "#replacement" if replacement else None,
    }
    limitation = "The original counter value 3 was not reconstructed. I separately verified the requested Ready label and counting behavior in the current build."
    verdict = {
        "accepted": True,
        "findings": "Current behavior and pixels reviewed.",
        "original_scene_status": "observed-context-matches",
    }
    final_verdict = (
        {
            "accepted": False,
            "findings": "The selected neighbor is missing without authorization, or its replacement is not exposed.",
        }
        if rejected_change
        else {
            "accepted": True,
            "findings": "The requested structural change preserves counting.",
            "original_scene_status": "observed-context-matches",
            "structural_changes": [structural],
        }
        if remove_region_neighbor or replacement
        else {
            "accepted": True,
            "findings": "The new label preserves counting and neighboring controls.",
            "original_scene_status": "not-reproduced",
            "scene_limitations": limitation,
        }
    )
    if replacement and rejected_change:
        verdict["structural_changes"] = [structural]
    if case == "requested-removal":
        verdict["structural_changes"] = [{**structural, "request_quote": "Remove all controls"}]
    candidate = {"selector": "#replacement"} if replacement else {}
    mobile_candidate = {} if case == "mobile-omitted-replacement" else candidate
    steps = [
        [
            (
                "choose_route",
                {"route": "quick_edit", "reason": "Change the label and preserve counting."},
            )
        ],
        [("read_selection", {}), ("read_file", {"path": "index.html"})],
        [
            ("set_acceptance_checks", {"checks": checks("Ready" if case == "text" else "0")}),
            (
                "edit_file",
                {
                    "path": "index.html",
                    "edits": [{"find": source["files"]["index.html"], "replacement": changed}],
                },
            ),
            ("build_project", {}),
        ],
        [("validate_preview", {})],
        [("submit_candidate", {"summary": "Updated the label."})],
        [
            ("read_review_files", {"paths": list(source["files"])}),
            ("inspect_preview", {"target": "baseline", "selection_id": "frozen"}),
        ],
        [
            (
                "inspect_preview",
                {
                    "target": "current",
                    "selection_id": "frozen",
                    **candidate,
                    "viewport": {"width": 1280, "height": 720},
                },
            ),
            (
                "inspect_preview",
                {
                    "target": "current",
                    "selection_id": "frozen",
                    **mobile_candidate,
                    "viewport": {"width": 375, "height": 812},
                },
            ),
        ],
        [("validate_preview", {})],
        [("record_review", verdict)],
        [("record_review", final_verdict)],
    ]
    metadata, events = [], []
    cancelled = False
    turn = 0

    def transport(**kwargs):
        nonlocal turn
        images = [
            json.loads(part["text"])
            for message in kwargs["messages"]
            if isinstance(message.get("content"), list)
            for part in message["content"]
            if part["type"] == "text"
        ]
        metadata.extend(images)
        assert turn < len(steps), (
            "Unexpected provider call after the controlled verdict",
            [
                data["output"]["error"]
                for kind, data in events
                if kind == "tool_end" and "error" in data.get("output", {})
            ],
        )
        calls = []
        for index, (name, arguments) in enumerate(copy.deepcopy(steps[turn])):
            if name == "record_review" and arguments["accepted"]:
                arguments["visual_evidence_ids"] = [
                    item["id"] for item in images if item["target"] == "current"
                ]
            calls.append(
                {
                    "index": index,
                    "id": f"call-{turn}-{index}",
                    "type": "function",
                    "function": {"name": name, "arguments": json.dumps(arguments)},
                }
            )
        turn += 1
        yield ChatCompletionChunk(
            id=f"turn-{turn}",
            created=0,
            model="gpt-5.4",
            object="chat.completion.chunk",
            choices=[{"index": 0, "delta": {"tool_calls": calls}, "finish_reason": "tool_calls"}],
        )

    def emit(kind, data):
        nonlocal cancelled
        events.append((kind, data))
        if (
            kind == "tool_end"
            and data.get("name") == "record_review"
            and data["output"].get("accepted") is False
        ):
            cancelled = True  # End this fault case after observing the independent rejection.

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=transport)))
    monkeypatch.setattr(OpenAICompletion, "_get_sync_client", lambda _: client)
    context = {
        "runId": "scene-run",
        "projectId": "project",
        "idea": "Counter",
        "request": request,
        "previousSource": source,
        "previousChecks": checks("0"),
        "selection": attachment,
    }
    if rejected_change:
        with pytest.raises((CancelledError, RuntimeAbort)) as stopped:
            execute_harness(settings, context, Checkpoints(), emit, lambda: cancelled)
        assert isinstance(getattr(stopped.value, "cause", stopped.value), CancelledError)
    else:
        result = execute_harness(settings, context, Checkpoints(), emit, lambda: cancelled)
        if case == "text":
            assert (
                "Ready" in result["html"]
                and 'id="neighbor"' in result["source"]["files"]["index.html"]
            )
            assert limitation in result["summary"]
            assert any(
                item["target"] == "baseline" and item["scene"]["status"] == "state-not-reproduced"
                for item in metadata
            )
            assert any(
                item["target"] == "current" and item["scene"]["status"] == "changed"
                for item in metadata
            )
        else:
            assert 'id="neighbor"' not in result["source"]["files"]["index.html"]
            assert structural["justification"] in result["summary"]
    current = [item for item in metadata if item["target"] == "current"]
    if remove_region_neighbor or replacement:
        assert current and all(
            any(
                member["nodeId"] == "neighbor" and member["status"] == "missing"
                for member in item["selectionResolutions"]
            )
            for item in current
        )
    if remove_region_neighbor:
        assert all(item["focusResolution"]["status"] == "resolved" for item in current)
    if case == "mobile-omitted-replacement":
        assert any(item.get("replacementResolution") is None for item in current)
        assert all(
            item["replacementResolution"]["status"] == "resolved"
            for item in current
            if item.get("replacementResolution")
        )
    elif replacement:
        expected = "state-not-reproduced" if rejected_change else "resolved"
        assert all(item["replacementResolution"]["status"] == expected for item in current)
        assert all(item["replacementResolution"]["selector"] == "#replacement" for item in current)
    assert all(item["scene"]["originalSceneVerified"] is False for item in metadata)
    rejected = [
        data["output"]["error"]
        for kind, data in events
        if kind == "tool_end" and data.get("name") == "record_review" and "error" in data["output"]
    ]
    assert len(rejected) == 1
    assert ("original captured context" if case == "text" else "visual") in rejected[0]
    assert turn == len(steps)
