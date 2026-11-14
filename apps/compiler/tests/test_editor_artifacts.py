"""Public compiler wire + real sandboxed-browser attribution/parity coverage.

Run with the backend Python environment after the compiler build. These tests use
its existing validate_artifact boundary; generated scripts run only in Chromium.
"""

import hashlib
import json
import os
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from formlane.compiler import safe_environment
from formlane.project import create_source
from formlane.validator import validate_artifact

COMPILER = Path(__file__).resolve().parents[1] / "dist" / "index.js"
MARKER = "data-formlane-source"


def compile_request(request):
    result = subprocess.run(
        ["node", str(COMPILER)],
        input=json.dumps(request),
        text=True,
        capture_output=True,
        timeout=30,
        env=safe_environment(),
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def assert_browser(html, checks):
    report = validate_artifact(
        html,
        checks,
        SimpleNamespace(browser_executable=os.environ.get("BROWSER_EXECUTABLE_PATH")),
        lambda: False,
    )
    assert report["valid"], report["issues"]


@pytest.mark.parametrize("template", ["vanilla", "react-ts"])
def test_editor_artifacts_map_rendered_instances_and_preserve_canonical_interactions(template):
    source = create_source(template)
    if template == "react-ts":
        source["files"]["src/App.tsx"] = """import { createElement, useState } from 'react'
function Counter({id}) {
  const [value, setValue] = useState(0)
  return <section id={id}><button onClick={() => setValue(value + 1)}>Increase</button><output>{value}</output></section>
}
export default function App() {
  return <main><Counter id="first"/><Counter id="second"/>{createElement('aside', {id: 'dynamic'}, 'Dynamic')}</main>
}
"""
        mapped_path = "src/App.tsx"
        expected_instances = "2"
    else:
        source["files"]["index.html"] = """<!doctype html>
<html><head><title>Compiler parity</title></head><body>
<main><section id="first"><button>Increase</button><output>0</output></section></main>
<script type="module" src="/src/main.js"></script>
</body></html>"""
        source["files"]["src/main.js"] = """document.querySelector('button').onclick = () => {
  const output = document.querySelector('output'); output.textContent = String(Number(output.textContent) + 1)
}
const aside = document.createElement('aside'); aside.id = 'dynamic'; aside.textContent = 'Dynamic'; document.body.append(aside)
"""
        mapped_path = "index.html"
        expected_instances = "1"

    canonical = compile_request(source)
    editor = compile_request({"mode": "editor", "source": source})
    assert set(canonical) == {"html", "sourceHash"}
    assert editor["html"] == canonical["html"]
    assert editor["sourceHash"] == canonical["sourceHash"]
    manifest = editor["manifest"]
    assert manifest["sourceHash"] == canonical["sourceHash"]
    for field, html in [("canonicalArtifactHash", editor["html"]), ("editorArtifactHash", editor["editorHtml"])]:
        assert manifest[field] == hashlib.sha256(html.encode()).hexdigest()
    buttons = [(key, value) for key, value in manifest["entries"].items() if value["tagName"] == "button"]
    assert len(buttons) == 1
    marker, location = buttons[0]
    assert location["path"] == mapped_path
    assert location["startLine"] == (4 if template == "react-ts" else 3)
    assert not any(value["tagName"] in {"Counter", "aside"} for value in manifest["entries"].values())

    state_checks = [
        {
            "name": "Initial state",
            "actions": [],
            "assertions": [
                {"kind": "text", "selector": "#first output", "expected": "0"},
                {"kind": "text", "selector": "#dynamic", "expected": "Dynamic"},
            ],
        },
        {
            "name": "Only the operated instance changes",
            "actions": [{"kind": "click", "selector": "#first button", "value": None}],
            "assertions": [
                {"kind": "text", "selector": "#first output", "expected": "1"},
                *([{"kind": "text", "selector": "#second output", "expected": "0"}] if template == "react-ts" else []),
            ],
        },
    ]
    assert_browser(editor["html"], state_checks + [{
        "name": "Canonical output has no editor annotations",
        "actions": [],
        "assertion": {"kind": "count", "selector": f"[{MARKER}]", "expected": "0"},
    }])
    assert_browser(editor["editorHtml"], state_checks + [{
        "name": "Exact source identity is shared only by repeated intrinsic instances",
        "actions": [],
        "assertions": [
            {"kind": "count", "selector": f'button[{MARKER}="{marker}"]', "expected": expected_instances},
            {"kind": "count", "selector": f"#dynamic[{MARKER}]", "expected": "0"},
        ],
    }])


def test_reserved_attributes_and_jsx_spreads_preserve_real_dom_semantics():
    source = create_source("react-ts")
    source["files"]["src/App.tsx"] = """const props = { 'data-formlane-source': 'application-owned' }
export default function App() {
  return <main><button id="spread" {...props}>Spread</button><button id="explicit" data-formlane-source="explicit-owned">Explicit</button><button id="mapped">Mapped</button></main>
}
"""
    editor = compile_request({"mode": "editor", "source": source})
    locations = [(key, value) for key, value in editor["manifest"]["entries"].items() if value["tagName"] == "button"]
    assert len(locations) == 1
    assert "application-owned" not in editor["manifest"]["entries"]
    assert "explicit-owned" not in editor["manifest"]["entries"]
    assert {item["code"] for item in editor["diagnostics"]} == {"reserved-marker", "jsx-spread"}
    assert_browser(editor["editorHtml"], [
        {
            "name": "Application attributes retain their values",
            "actions": [],
            "assertions": [
                {"kind": "attribute", "selector": "#spread", "attribute": MARKER, "expected": "application-owned"},
                {"kind": "attribute", "selector": "#explicit", "attribute": MARKER, "expected": "explicit-owned"},
            ],
        },
        {
            "name": "Safe sibling gets an authoritative build-local source ID",
            "actions": [],
            "assertion": {"kind": "attribute", "selector": "#mapped", "attribute": MARKER, "expected": locations[0][0]},
        },
    ])


def test_template_clones_keep_source_identity_and_string_created_dom_is_unmapped():
    source = create_source("vanilla")
    source["files"]["index.html"] = """<!doctype html><html><body>
<template id="row"><button>Cloned row</button></template><main></main>
<script type="module" src="/src/main.js"></script></body></html>"""
    source["files"]["src/main.js"] = """const template = document.querySelector('template')
const main = document.querySelector('main')
main.append(template.content.cloneNode(true), template.content.cloneNode(true))
main.insertAdjacentHTML('beforeend', '<aside id="dynamic">String created</aside>')
"""
    editor = compile_request({"mode": "editor", "source": source})
    buttons = [key for key, value in editor["manifest"]["entries"].items() if value["tagName"] == "button"]
    assert len(buttons) == 1
    assert_browser(editor["editorHtml"], [
        {
            "name": "Template clones share their immutable definition",
            "actions": [],
            "assertion": {"kind": "count", "selector": f'main button[{MARKER}="{buttons[0]}"]', "expected": "2"},
        },
        {
            "name": "Runtime string insertion has no fabricated source",
            "actions": [],
            "assertions": [
                {"kind": "text", "selector": "#dynamic", "expected": "String created"},
                {"kind": "count", "selector": f"#dynamic[{MARKER}]", "expected": "0"},
            ],
        },
    ])


@pytest.mark.parametrize("wire_request", [
    {"mode": "unknown", "source": create_source("vanilla")},
    {"mode": "editor", "source": create_source("vanilla"), "manifest": {"entries": {"forged": {}}}},
    {"mode": "editor", "source": None},
])
def test_subprocess_rejects_unknown_modes_and_caller_supplied_manifests(wire_request):
    result = subprocess.run(
        ["node", str(COMPILER)], input=json.dumps(wire_request), text=True,
        capture_output=True, timeout=30, env=safe_environment(), check=False,
    )
    assert result.returncode == 1
    assert set(json.loads(result.stdout)) == {"error"}
