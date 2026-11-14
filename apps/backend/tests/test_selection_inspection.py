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
        html, request,
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
    result = inspect('<!doctype html><button>One</button><button>Two</button>', selector=selector)
    assert result["resolution"]["status"] == status


def test_inspection_reports_unreproduced_scene_and_supported_actions():
    html = '''<!doctype html><button id="open" onclick="document.querySelector('dialog').showModal()">Open</button>
    <dialog><p id="target">Original scene</p></dialog>'''
    target = {"tagName": "p", "text": "Original scene", "attributes": {}, "styles": {}}
    closed = inspect(html, selector="#target", selectionContext=target)
    assert closed["resolution"]["status"] == "state-not-reproduced"
    opened = inspect(html, selector="#target", selectionContext=target,
                     actions=[{"kind": "click", "selector": "#open", "value": None}])
    assert opened["resolution"]["status"] == "resolved"
    assert opened["actionsPerformed"] == 1


def test_inspection_replays_original_small_viewport_clock_seed_and_actions():
    html = '''<!doctype html><output id="state"></output><button id="go" onclick="document.querySelector('#state').textContent = new Date().toISOString() + ':' + Math.random()">Go</button>'''
    request = {
        "selector": "body", "viewport": {"width": 800, "height": 600},
        "clock": {"now": "2026-03-18T10:00:00+00:00"}, "seed": 1,
        "actions": [{"kind": "click", "selector": "#go", "value": None}],
    }
    result = inspect(html, **request)
    assert "2026-03-18T10:00:00.000Z:0.6270739405881613" in result["accessibilityTree"]
    assert result["image"]["width"] == 800 and result["image"]["height"] == 600


def test_region_resolution_keeps_missing_members_explicit():
    result = inspect('<!doctype html><h1 id="title">Title</h1>', selector="body",
                     selectionTargets=[{"nodeId": "one", "tagName": "h1", "selector": "#title"},
                                       {"nodeId": "two", "tagName": "button", "selector": "#removed"}])
    assert result["resolution"]["status"] == "missing"
    assert result["selectionResolutions"] == [
        {"nodeId": "one", "status": "resolved", "matches": 1},
        {"nodeId": "two", "status": "missing", "matches": 0},
    ]
