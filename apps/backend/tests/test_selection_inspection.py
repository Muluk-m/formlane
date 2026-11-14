"""Browser evidence at the public sandbox inspection boundary."""

import base64
import io
import os
from types import SimpleNamespace

import pytest
from PIL import Image

from formlane.project import artifact_hash
from formlane.validator import inspect_artifact


def inspect(html, **request):
    return inspect_artifact(
        html,
        request,
        SimpleNamespace(browser_executable=os.environ.get("BROWSER_EXECUTABLE_PATH")),
        lambda: False,
    )


def test_inspection_returns_real_current_artifact_pixels_and_unique_resolution():
    html = '<!doctype html><body style="background:rgb(255,0,0)"><button id="target">Save</button>'
    result = inspect(html, selector="#target")
    assert result["resolution"]["status"] == "resolved"
    assert result["artifactHash"] == artifact_hash(html)
    image = result["image"]
    assert image["provenance"] == "server-reconstructed"
    pixels = Image.open(io.BytesIO(base64.b64decode(image["base64"])))
    assert pixels.size == (1280, 720)
    assert pixels.convert("RGB").getpixel((1000, 500)) == (255, 0, 0)


@pytest.mark.parametrize(("selector", "status"), [("button", "ambiguous"), ("#gone", "missing")])
def test_inspection_never_silently_chooses_first_match(selector, status):
    result = inspect("<!doctype html><button>One</button><button>Two</button>", selector=selector)
    assert result["resolution"]["status"] == status


def test_inspection_reports_unreproduced_scene_and_supported_actions():
    html = """<!doctype html><button id="open" onclick="document.querySelector('dialog').showModal()">Open</button>
    <dialog><p id="target">Original scene</p></dialog>"""
    target = {"tagName": "p", "text": "Original scene", "attributes": {}, "styles": {}}
    closed = inspect(html, selector="#target", selectionContext=target)
    assert closed["resolution"]["status"] == "state-not-reproduced"
    opened = inspect(
        html,
        selector="#target",
        selectionContext=target,
        actions=[{"kind": "click", "selector": "#open", "value": None}],
    )
    assert opened["resolution"]["status"] == "resolved", {
        key: value for key, value in opened.items() if key != "image"
    }
    assert opened["actionsPerformed"] == 1


def test_inspection_replays_original_small_viewport_clock_seed_and_actions():
    html = """<!doctype html><output id="state"></output><button id="go" onclick="document.querySelector('#state').textContent = new Date().toISOString() + ':' + Math.random()">Go</button>"""
    request = {
        "selector": "body",
        "viewport": {"width": 800, "height": 600},
        "clock": {"now": "2026-03-18T10:00:00+00:00"},
        "seed": 1,
        "actions": [{"kind": "click", "selector": "#go", "value": None}],
    }
    result = inspect(html, **request)
    assert "2026-03-18T10:00:00.000Z:0.6270739405881613" in result["accessibilityTree"]
    assert result["image"]["width"] == 800 and result["image"]["height"] == 600


def test_region_resolution_keeps_missing_members_explicit():
    result = inspect(
        '<!doctype html><h1 id="title">Title</h1>',
        selector="body",
        selectionTargets=[
            {"nodeId": "one", "tagName": "h1", "selector": "#title"},
            {"nodeId": "two", "tagName": "button", "selector": "#removed"},
        ],
    )
    assert result["resolution"]["status"] == "missing"
    assert result["selectionResolutions"] == [
        {"nodeId": "one", "status": "resolved", "matches": 1},
        {"nodeId": "two", "status": "missing", "matches": 0},
    ]


def test_unique_counter_target_does_not_certify_original_transient_state():
    html = """<!doctype html><output id="counter">0</output>
    <button id="increment" onclick="document.querySelector('output').textContent++">Add</button>"""
    target = {
        "nodeId": "counter",
        "selector": "#counter",
        "tagName": "output",
        "text": "3",
        "attributes": {},
    }
    fresh = inspect(html, target="baseline", selector="#counter", selectionContext=target)
    assert fresh["resolution"]["status"] == "resolved"
    assert fresh["scene"]["status"] == "state-not-reproduced"
    assert fresh["scene"]["observations"][0]["text"] == "0"
    replayed = inspect(
        html,
        target="baseline",
        selector="#counter",
        selectionContext=target,
        actions=[{"kind": "click", "selector": "#increment", "value": None}] * 3,
    )
    assert replayed["scene"]["status"] == "observed-context-matches"
    assert replayed["scene"]["originalSceneVerified"] is False
    edited = inspect(
        '<!doctype html><output id="counter">Three items</output>',
        target="current",
        selector="#counter",
        selectionContext=target,
    )
    assert edited["resolution"]["status"] == "resolved"
    assert edited["scene"]["status"] == "changed"
    assert edited["scene"]["originalSceneVerified"] is False


def test_nested_scroll_target_must_be_exposed_before_visual_evidence_is_eligible():
    html = """<!doctype html><button id="reveal" onclick="document.querySelector('#scroller').scrollTop=200">Reveal</button>
    <div id="scroller" style="height:60px;overflow:auto"><div style="height:200px"></div>
    <button id="target">Selected</button></div>"""
    target = {
        "nodeId": "selected",
        "selector": "#target",
        "tagName": "button",
        "text": "Selected",
        "attributes": {},
    }
    clipped = inspect(html, target="baseline", selector="#target", selectionTargets=[target])
    assert clipped["resolution"]["status"] == "state-not-reproduced"
    assert clipped["scene"]["status"] == "state-not-reproduced"
    exposed = inspect(
        html,
        target="baseline",
        selector="#target",
        selectionTargets=[target],
        actions=[{"kind": "click", "selector": "#reveal", "value": None}],
    )
    assert exposed["resolution"]["status"] == "resolved"
    assert exposed["scene"]["status"] == "observed-context-matches"


def test_region_focus_cannot_hide_a_missing_neighbor():
    focus = {
        "nodeId": "focus",
        "selector": "#focus",
        "tagName": "h1",
        "text": "Keep",
        "attributes": {},
    }
    neighbor = {
        "nodeId": "neighbor",
        "selector": "#neighbor",
        "tagName": "button",
        "text": "Save",
        "attributes": {},
    }
    result = inspect(
        '<!doctype html><h1 id="focus">Keep</h1>',
        target="current",
        selector="#focus",
        selectionFocus=focus,
        selectionTargets=[focus, neighbor],
    )
    assert result["focusResolution"]["status"] == "resolved"
    assert result["resolution"]["status"] == "missing"
    assert {item["nodeId"]: item["status"] for item in result["selectionResolutions"]} == {
        "focus": "resolved",
        "neighbor": "missing",
    }


@pytest.mark.parametrize(
    "style", ["display:none", "position:absolute;left:-5000px", "margin-top:200px"]
)
def test_explicit_replacement_candidates_require_native_viewport_and_clip_exposure(style):
    original = {"nodeId": "original", "selector": "#original", "tagName": "button", "text": "Old"}
    html = f'<!doctype html><div style="height:40px;overflow:hidden"><button id="replacement" style="{style}">New</button></div>'
    result = inspect(
        html,
        target="current",
        selector="#replacement",
        replacementSelector="#replacement",
        selectionTargets=[original],
    )
    assert result["replacementResolution"]["status"] == "state-not-reproduced"
    assert result["replacementResolution"]["selector"] == "#replacement"
    assert result["selectionResolutions"] == [
        {"nodeId": "original", "status": "missing", "matches": 0}
    ]
