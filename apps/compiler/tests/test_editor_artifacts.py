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
    html = html.replace(
        "</body>",
        """<pre hidden id="click-probe"></pre><script>
        const probe = {events: [], handler: !!document.querySelector('button')?.onclick};
        const evidence = document.querySelector('#click-probe');
        evidence.textContent = JSON.stringify(probe);
        for (const type of ['pointerdown', 'pointerup', 'click']) {
          document.addEventListener(type, event => {
            probe.events.push({type, target: event.target.tagName, trusted: event.isTrusted,
              value: document.querySelector('output')?.textContent});
            evidence.textContent = JSON.stringify(probe);
          }, true);
        }
        </script></body>""",
    )
    checks = [
        {
            **check,
            "assertions": [
                *check.get("assertions", []),
                *(
                    [{"kind": "text", "selector": "#click-probe", "expected": "click"}]
                    if any(action["kind"] == "click" for action in check["actions"])
                    else []
                ),
            ],
        }
        for check in checks
    ]
    report = validate_artifact(
        html,
        checks,
        SimpleNamespace(browser_executable=os.environ.get("BROWSER_EXECUTABLE_PATH")),
        lambda: False,
    )
    assert report["valid"], report


@pytest.mark.parametrize("template", ["vanilla", "react-ts"])
def test_editor_artifacts_map_rendered_instances_and_preserve_canonical_interactions(
    template,
):
    source = create_source(template)
    if template == "react-ts":
        source["files"][
            "src/App.tsx"
        ] = """import { createElement, useState } from 'react'
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
        source["files"][
            "src/main.js"
        ] = """document.querySelector('button').onclick = () => {
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
    for field, html in [
        ("canonicalArtifactHash", editor["html"]),
        ("editorArtifactHash", editor["editorHtml"]),
    ]:
        assert manifest[field] == hashlib.sha256(html.encode()).hexdigest()
    buttons = [
        (key, value)
        for key, value in manifest["entries"].items()
        if value["tagName"] == "button"
    ]
    assert len(buttons) == 1
    marker, location = buttons[0]
    assert location["path"] == mapped_path
    assert location["startLine"] == (4 if template == "react-ts" else 3)
    assert not any(
        value["tagName"] in {"Counter", "aside"}
        for value in manifest["entries"].values()
    )

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
                *(
                    [{"kind": "text", "selector": "#second output", "expected": "0"}]
                    if template == "react-ts"
                    else []
                ),
            ],
        },
    ]
    assert_browser(
        editor["html"],
        state_checks
        + [
            {
                "name": "Canonical output has no editor annotations",
                "actions": [],
                "assertion": {
                    "kind": "count",
                    "selector": f"[{MARKER}]",
                    "expected": "0",
                },
            }
        ],
    )
    assert_browser(
        editor["editorHtml"],
        state_checks
        + [
            {
                "name": "Exact source identity is shared only by repeated intrinsic instances",
                "actions": [],
                "assertions": [
                    {
                        "kind": "count",
                        "selector": f'button[{MARKER}="{marker}"]',
                        "expected": expected_instances,
                    },
                    {
                        "kind": "count",
                        "selector": f"#dynamic[{MARKER}]",
                        "expected": "0",
                    },
                ],
            }
        ],
    )


def test_reserved_attributes_and_jsx_spreads_preserve_real_dom_semantics():
    source = create_source("react-ts")
    source["files"]["src/App.tsx"] = """import { useState } from 'react'
const props = { 'data-formlane-source': 'application-owned' }
export default function App() {
  const [value, setValue] = useState('idle')
  return <main><button id="spread" onClick={() => setValue('spread')} {...props}>Spread</button><button id="explicit" data-formlane-source="explicit-owned">Explicit</button><button id="mapped" onClick={() => setValue('mapped')}>Mapped</button><output id="result">{value}</output></main>
}
"""
    editor = compile_request({"mode": "editor", "source": source})
    locations = [
        (key, value)
        for key, value in editor["manifest"]["entries"].items()
        if value["tagName"] == "button"
    ]
    assert locations == []
    assert editor["editorHtml"] == editor["html"]
    assert "application-owned" not in editor["manifest"]["entries"]
    assert "explicit-owned" not in editor["manifest"]["entries"]
    assert {item["code"] for item in editor["diagnostics"]} == {"reserved-marker"}
    assert_browser(
        editor["editorHtml"],
        [
            {
                "name": "Application attributes retain their values",
                "actions": [{"kind": "click", "selector": "#spread", "value": None}],
                "assertions": [
                    {
                        "kind": "attribute",
                        "selector": "#spread",
                        "attribute": MARKER,
                        "expected": "application-owned",
                    },
                    {
                        "kind": "attribute",
                        "selector": "#explicit",
                        "attribute": MARKER,
                        "expected": "explicit-owned",
                    },
                    {"kind": "text", "selector": "#result", "expected": "spread"},
                ],
            },
            {
                "name": "Unmapped siblings retain ordinary behavior",
                "actions": [{"kind": "click", "selector": "#mapped", "value": None}],
                "assertions": [
                    {
                        "kind": "count",
                        "selector": f"#mapped[{MARKER}]",
                        "expected": "0",
                    },
                    {"kind": "text", "selector": "#result", "expected": "mapped"},
                ],
            },
        ],
    )


@pytest.mark.parametrize("template", ["vanilla", "react-ts"])
def test_application_marker_selectors_cannot_hide_editor_siblings(template):
    source = create_source(template)
    if template == "react-ts":
        source["files"]["src/App.tsx"] = """import { useState } from 'react'
export default function App() {
  const [count, setCount] = useState(0)
  return <main><style>{'[data-formlane-source]{display:none}'}</style><button onClick={() => setCount(count + 1)}>Increase</button><output>{count}</output></main>
}"""
    else:
        source["files"]["index.html"] = """<!doctype html><html><body>
<style>[data-formlane-source]{display:none}</style><button>Increase</button><output>0</output>
<script type="module" src="/src/main.js"></script></body></html>"""
        source["files"][
            "src/main.js"
        ] = """document.querySelector('button').onclick = () => {
  const output = document.querySelector('output'); output.textContent = String(Number(output.textContent) + 1)
}"""
    editor = compile_request({"mode": "editor", "source": source})
    assert editor["manifest"]["entries"] == {}
    assert editor["editorHtml"] == editor["html"]
    assert_browser(
        editor["editorHtml"],
        [
            {
                "name": "Initial content remains visible",
                "actions": [],
                "assertion": {"kind": "text", "selector": "output", "expected": "0"},
            },
            {
                "name": "Application selector preserves visible interactive content",
                "actions": [{"kind": "click", "selector": "button", "value": None}],
                "assertion": {"kind": "text", "selector": "output", "expected": "1"},
            },
        ],
    )


def test_template_clones_keep_source_identity_and_string_created_dom_is_unmapped():
    source = create_source("vanilla")
    source["files"]["index.html"] = """<!doctype html><html><body>
<template id="row"><button>Cloned row</button></template><main></main>
<script type="module" src="/src/main.js"></script></body></html>"""
    source["files"][
        "src/main.js"
    ] = """const template = document.querySelector('template')
const main = document.querySelector('main')
main.append(template.content.cloneNode(true), template.content.cloneNode(true))
main.insertAdjacentHTML('beforeend', '<aside id="dynamic">String created</aside>')
main.addEventListener('click', event => {
  if (event.target instanceof HTMLButtonElement) event.target.textContent = 'Used clone'
})
"""
    editor = compile_request({"mode": "editor", "source": source})
    buttons = [
        key
        for key, value in editor["manifest"]["entries"].items()
        if value["tagName"] == "button"
    ]
    assert len(buttons) == 1
    assert_browser(
        editor["editorHtml"],
        [
            {
                "name": "Template clones share their immutable definition",
                "actions": [
                    {
                        "kind": "click",
                        "selector": "main button:first-child",
                        "value": None,
                    }
                ],
                "assertions": [
                    {
                        "kind": "count",
                        "selector": f'main button[{MARKER}="{buttons[0]}"]',
                        "expected": "2",
                    },
                    {
                        "kind": "text",
                        "selector": "main button:first-child",
                        "expected": "Used clone",
                    },
                    {
                        "kind": "text",
                        "selector": "main button:nth-child(2)",
                        "expected": "Cloned row",
                    },
                ],
            },
            {
                "name": "Runtime string insertion has no fabricated source",
                "actions": [],
                "assertions": [
                    {
                        "kind": "text",
                        "selector": "#dynamic",
                        "expected": "String created",
                    },
                    {
                        "kind": "count",
                        "selector": f"#dynamic[{MARKER}]",
                        "expected": "0",
                    },
                ],
            },
        ],
    )


@pytest.mark.parametrize(
    "wire_request",
    [
        {"mode": "unknown", "source": create_source("vanilla")},
        {
            "mode": "editor",
            "source": create_source("vanilla"),
            "manifest": {"entries": {"forged": {}}},
        },
        {"mode": "editor", "source": None},
    ],
)
def test_subprocess_rejects_unknown_modes_and_caller_supplied_manifests(wire_request):
    result = subprocess.run(
        ["node", str(COMPILER)],
        input=json.dumps(wire_request),
        text=True,
        capture_output=True,
        timeout=30,
        env=safe_environment(),
        check=False,
    )
    assert result.returncode == 1
    assert set(json.loads(result.stdout)) == {"error"}
