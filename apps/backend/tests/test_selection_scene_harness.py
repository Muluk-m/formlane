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


ORIGINAL = '''<!doctype html><html><body><h1 id="title">0</h1>
<button id="increment">Add</button><button id="neighbor">Keep me</button>
<script>let count=0; document.querySelector('#increment').onclick=()=>{
 document.querySelector('#title').textContent=String(++count);
};</script></body></html>'''


def checks(initial):
    return [
        {"name": "Initial label", "actions": [], "assertions": [
            {"kind": "text", "selector": "#title", "expected": initial}]},
        {"name": "Counting still works", "actions": [
            {"kind": "click", "selector": "#increment", "value": None}], "assertions": [
            {"kind": "text", "selector": "#title", "expected": "1"}]},
    ]


def element(node, tag, text):
    return {"nodeId": node, "sourceId": None, "selector": "#" + node,
            "tagName": tag, "text": text, "attributes": {}, "styles": {},
            "viewport": {"width": 1280, "height": 720}, "scroll": {"x": 0, "y": 0},
            "instance": {"label": text, "context": "Counter"}}


@pytest.mark.parametrize("remove_region_neighbor", [False, True])
def test_scene_limitations_allow_intended_text_edits_but_focus_does_not_hide_deletions(
    monkeypatch, remove_region_neighbor
):
    settings = compiler_settings()
    settings.openai_api_key = "controlled-provider"
    settings.model = "gpt-5.4"
    settings.endpoint = "http://127.0.0.1:1/v1"
    source = legacy_source(ORIGINAL)
    baseline = compile_project(source, settings, lambda: False)
    selected = element("title", "h1", "0" if remove_region_neighbor else "3")
    neighbor = element("neighbor", "button", "Keep me")
    evidence = ({"kind": "region", "elements": [selected, neighbor], "focus": selected,
                 "rectangle": {"x": 0, "y": 0, "width": 400, "height": 200},
                 "viewport": selected["viewport"], "scroll": selected["scroll"]}
                if remove_region_neighbor else {"kind": "element", "element": selected})
    attachment = {"selectionId": "frozen", "versionId": "baseline", "projectId": "project",
                  "sourceHash": source_hash(source), "canonicalArtifactHash": artifact_hash(baseline["html"]),
                  "evidence": evidence, "sourceResolutions": [
                      {"nodeId": item["nodeId"], "status": "unmapped", "reason": "Runtime context"}
                      for item in ([selected, neighbor] if remove_region_neighbor else [selected])],
                  "image": None}
    changed = (ORIGINAL.replace('<button id="neighbor">Keep me</button>', "")
               if remove_region_neighbor else ORIGINAL.replace('id="title">0', 'id="title">Ready'))
    limitation = "The original counter value 3 was not reconstructed. I separately verified the requested Ready label and counting behavior in the current build."
    verdict = {"accepted": True, "findings": "Current behavior and pixels reviewed.",
               "original_scene_status": "observed-context-matches"}
    final_verdict = ({"accepted": False, "findings": "The focused heading remains but its selected neighbor is missing."}
                     if remove_region_neighbor else
                     {"accepted": True, "findings": "The new label preserves counting and neighboring controls.",
                      "original_scene_status": "not-reproduced", "scene_limitations": limitation})
    steps = [
        [("choose_route", {"route": "quick_edit", "reason": "Change the label and preserve counting."})],
        [("read_selection", {}), ("read_file", {"path": "index.html"})],
        [("set_acceptance_checks", {"checks": checks("0" if remove_region_neighbor else "Ready")}),
         ("edit_file", {"path": "index.html", "edits": [{"find": source["files"]["index.html"], "replacement": changed}]}),
         ("build_project", {})],
        [("validate_preview", {})],
        [("submit_candidate", {"summary": "Updated the label."})],
        [("read_review_files", {"paths": list(source["files"])}),
         ("inspect_preview", {"target": "baseline", "selection_id": "frozen"})],
        [("inspect_preview", {"target": "current", "selection_id": "frozen", "viewport": {"width": 1280, "height": 720}}),
         ("inspect_preview", {"target": "current", "selection_id": "frozen", "viewport": {"width": 375, "height": 812}})],
        [("validate_preview", {})],
        [("record_review", verdict)],
        [("record_review", final_verdict)],
    ]
    metadata, events = [], []
    cancelled = False
    turn = 0

    def transport(**kwargs):
        nonlocal turn
        images = [json.loads(part["text"]) for message in kwargs["messages"]
                  if isinstance(message.get("content"), list) for part in message["content"]
                  if part["type"] == "text"]
        metadata.extend(images)
        assert turn < len(steps), "Unexpected provider call after the controlled verdict"
        calls = []
        for index, (name, arguments) in enumerate(copy.deepcopy(steps[turn])):
            if name == "record_review" and arguments["accepted"]:
                arguments["visual_evidence_ids"] = [item["id"] for item in images if item["target"] == "current"]
            calls.append({"index": index, "id": f"call-{turn}-{index}", "type": "function",
                          "function": {"name": name, "arguments": json.dumps(arguments)}})
        turn += 1
        yield ChatCompletionChunk(id=f"turn-{turn}", created=0, model="gpt-5.4", object="chat.completion.chunk",
                                  choices=[{"index": 0, "delta": {"tool_calls": calls}, "finish_reason": "tool_calls"}])

    def emit(kind, data):
        nonlocal cancelled
        events.append((kind, data))
        if (kind == "tool_end" and data.get("name") == "record_review"
                and data["output"].get("accepted") is False):
            cancelled = True  # End this fault case after observing the independent rejection.

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=transport)))
    monkeypatch.setattr(OpenAICompletion, "_get_sync_client", lambda _: client)
    context = {"runId": "scene-run", "projectId": "project", "idea": "Counter",
               "request": ("Make the heading smaller; preserve counting and the neighboring control."
                           if remove_region_neighbor else
                           "Change the initial heading label to Ready; preserve counting and the neighboring control."),
               "previousSource": source, "previousChecks": checks("0"), "selection": attachment}
    if remove_region_neighbor:
        with pytest.raises((CancelledError, RuntimeAbort)) as stopped:
            execute_harness(settings, context, Checkpoints(), emit, lambda: cancelled)
        assert isinstance(getattr(stopped.value, "cause", stopped.value), CancelledError)
        current = [item for item in metadata if item["target"] == "current"]
        assert current and all(item["resolution"]["status"] == "missing" for item in current)
        assert all(item["focusResolution"]["status"] == "resolved" for item in current)
        assert all(any(member["nodeId"] == "neighbor" and member["status"] == "missing"
                       for member in item["selectionResolutions"]) for item in current)
    else:
        result = execute_harness(settings, context, Checkpoints(), emit, lambda: cancelled)
        assert "Ready" in result["html"] and 'id="neighbor"' in result["source"]["files"]["index.html"]
        assert limitation in result["summary"]
        assert any(item["target"] == "baseline" and item["scene"]["status"] == "state-not-reproduced" for item in metadata)
        assert any(item["target"] == "current" and item["scene"]["status"] == "changed" for item in metadata)
        assert all(item["scene"]["originalSceneVerified"] is False for item in metadata)
    rejected = [data["output"]["error"] for kind, data in events
                if kind == "tool_end" and data.get("name") == "record_review" and "error" in data["output"]]
    assert len(rejected) == 1
    assert ("visual" if remove_region_neighbor else "original captured context") in rejected[0]
    assert turn == len(steps)
