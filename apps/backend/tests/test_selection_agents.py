"""Selection context and private native-image delivery at the agent tool boundary."""

import base64
import copy
import json
import io
from types import SimpleNamespace

import pytest
from crewai.llms.providers.openai.completion import OpenAICompletion
from openai.types.chat import ChatCompletionChunk
from PIL import Image

from formlane.delivery._crewai import ObservedOpenAI
from formlane.delivery.stages import Delivery
from formlane.delivery.tools import tools_for_stage
from formlane.delivery.workspace import Runtime
from formlane.project import artifact_hash, create_source, source_hash
from test_agents import Checkpoints

_pixels = io.BytesIO()
Image.new("RGB", (1, 1), "red").save(_pixels, format="PNG")
IMAGE = {"provenance": "client-captured", "mimeType": "image/png", "base64": base64.b64encode(_pixels.getvalue()).decode(), "width": 1, "height": 1}


def selection(source):
    return {
        "selectionId": "selection-1", "projectId": "project", "versionId": "baseline",
        "sourceHash": source_hash(source), "canonicalArtifactHash": artifact_hash("baseline"),
        "evidence": {"kind": "element", "element": {
            "nodeId": "node-1", "sourceId": None, "tagName": "button", "text": "Save",
            "selector": "#save", "attributes": {}, "styles": {},
            "viewport": {"width": 1280, "height": 720}, "scroll": {"x": 0, "y": 0},
            "instance": {"label": "Second card", "context": "Ada"},
        }},
        "sourceResolutions": [{"nodeId": "node-1", "status": "unmapped", "reason": "dynamic"}],
        "image": copy.deepcopy(IMAGE),
    }


def make_runtime():
    source = create_source("vanilla")
    source["files"]["index.html"] += '<button id="save">Save</button>'
    attached = selection(source)
    context = {"runId": "run", "projectId": "project", "idea": "old idea",
               "request": "Change only Ada's button", "previousSource": source,
               "previousChecks": None, "selection": attached}
    events = []
    rt = Runtime(SimpleNamespace(), context, Checkpoints(),
                 lambda kind, data: events.append((kind, data)), lambda: False)
    return rt, attached, events


def test_selection_tool_returns_frozen_authoritative_context_without_image_text():
    rt, attachment, events = make_runtime()
    attachment["evidence"]["element"]["text"] = "mutated browser"
    tool = next(tool for tool in tools_for_stage(rt, "builder") if tool.name == "read_selection")
    value = json.loads(tool.run())
    assert value["selection"]["evidence"]["element"]["text"] == "Save"
    assert value["selection"]["sourceResolutions"][0]["status"] == "unmapped"
    assert value["sourceCandidates"][0]["confidence"] == "heuristic"
    assert value["warnings"]
    assert IMAGE["base64"] not in json.dumps(value)
    assert "Second card" not in json.dumps(events)
    assert IMAGE["base64"] not in json.dumps(events)


def test_native_provider_receives_selection_pixels_and_replay_preserves_original(monkeypatch):
    rt, attachment, events = make_runtime()
    observed = []

    def transport(**kwargs):
        observed.append(copy.deepcopy(kwargs["messages"]))
        yield ChatCompletionChunk(id="one", created=0, model="model", object="chat.completion.chunk",
            choices=[{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "route", "type": "function",
                "function": {"name": "choose_route", "arguments": json.dumps({"route": "plan", "reason": "Behavior change"})}}]},
                "finish_reason": "tool_calls"}])

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=transport)))
    monkeypatch.setattr(OpenAICompletion, "_get_sync_client", lambda _: client)
    model = ObservedOpenAI(model="model", api_key="controlled", custom_openai=True, stream=True,
                           max_retries=0, additional_params={"parallel_tool_calls": False}).bind(rt)
    delivery = Delivery(rt, lambda effort: model)
    original = copy.deepcopy(rt.workspace)
    assert delivery.route() == "plan"
    images = [part for message in observed[0] if isinstance(message.get("content"), list)
              for part in message["content"] if part["type"] == "image_url"]
    assert images == [{"type": "image_url", "image_url": {"url": "data:image/png;base64," + IMAGE["base64"], "detail": "high"}}]
    assert all(IMAGE["base64"] not in message["content"] for message in observed[0]
               if isinstance(message.get("content"), str))
    attachment["image"]["base64"] = "changed"
    rt.workspace = original
    assert delivery.route() == "plan"
    assert len(observed) == 1
    assert IMAGE["base64"] not in json.dumps(events)


def test_stale_selection_reference_cannot_be_rebound_to_current():
    rt, _, _ = make_runtime()
    value = rt.invoke(rt.inspect_preview, {"target": "current", "selection_id": "other"})
    assert value["resolution"]["status"] == "stale"


def test_baseline_and_client_images_cannot_satisfy_current_visual_approval():
    rt, _, _ = make_runtime()
    with rt.scoped("review-0", "david"):
        value = rt.invoke(rt.record_review, {"accepted": True, "findings": "Looks right", "visual_evidence_ids": ["selection-1"]})
    assert "error" in value
    assert "visual" in value["error"]


def test_public_harness_rejects_client_only_review_and_recovers_frozen_selection(monkeypatch):
    from test_flow_equivalence import INPUTS, observe_scenario

    attached = selection(create_source("vanilla"))
    attached["canonicalArtifactHash"] = artifact_hash(INPUTS["html"])
    observed = observe_scenario("quick_edit", monkeypatch, selection=attached, replay=True)
    first, recovered = observed["attempts"]
    assert first["failure"] == {"code": "cancelled"}
    assert recovered["failure"] is None and recovered["result"]
    assert recovered["result"]["html"] == INPUTS["html"]
    assert observed["context"]["selection"] == attached
    rejected = [event["data"]["output"] for event in recovered["events"]
                if event["type"] == "tool_end" and event["data"].get("name") == "record_review"
                and "error" in event["data"]["output"]]
    assert len(rejected) == 2
    assert all("visual" in item["error"] for item in rejected)
    assert any(request["native_image_count"] >= 3 for request in observed["provider_requests"])
    assert len([item for item in observed["external_outcomes"] if item["kind"] == "compiler"]) == 2
    public = json.dumps(recovered["events"])
    assert attached["image"]["base64"] not in public
    assert "Second card" not in public


def test_public_harness_rejects_stale_current_screenshot_before_visual_approval(monkeypatch):
    from test_flow_equivalence import observe_scenario

    observed = observe_scenario("quick_edit", monkeypatch, stale_inspection=True)
    assert observed["attempts"][-1]["result"]
    errors = [json.loads(item["content"]).get("error", "")
              for request in observed["provider_requests"] for item in request["tool_results"]]
    assert any("does not match the requested artifact" in error for error in errors)
    assert len([item for item in observed["external_outcomes"]
                if item["kind"] == "browser" and item["payload"].get("mode") == "inspect"]) == 3
