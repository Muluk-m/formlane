import os
import threading
import time
from concurrent.futures import CancelledError
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace

import pytest

from formlane.project import MAX_PREVIEW_BYTES, artifact_hash
from formlane.validator import validate_artifact, validate_checks

HTML = """<!doctype html><html><body>
<input id="name" value="">
<button id="save" onclick="document.querySelector('#status').textContent='Saved '+document.querySelector('#name').value">Save</button>
<p id="status" data-state="ready">Not saved</p>
</body></html>"""


def settings():
    return SimpleNamespace(browser_executable=os.environ.get("BROWSER_EXECUTABLE_PATH"))


def assertion(kind="text", selector="#status", expected="Saved", **extra):
    return {"kind": kind, "selector": selector, "expected": expected, **extra}


def check(name="save", actions=None, assertions=None, **extra):
    return {
        "name": name,
        "actions": actions
        if actions is not None
        else [{"kind": "click", "selector": "#save", "value": None}],
        "assertions": assertions or [assertion()],
        **extra,
    }


def validate(html, checks):
    return validate_artifact(html, checks, settings(), lambda: False)


@pytest.mark.parametrize(
    "action",
    [
        {"kind": "evaluate", "selector": "body", "value": "fetch(secret)"},
        {"kind": "press", "selector": "#name", "value": "Control+L"},
        {"kind": "press", "selector": "#name", "value": None},
        {"kind": "reload", "selector": "#name", "value": None},
        {"kind": "reload", "selector": "body", "value": "https://example.com"},
        {"kind": "click", "selector": "#save", "value": "Enter"},
        {"kind": "click", "selector": "#save"},
        {"kind": "fill", "selector": "#name", "value": None},
        {"kind": "select", "selector": "#plan", "value": None},
        {"kind": "select", "selector": "#plan", "value": 1},
        {"kind": "select", "selector": "#plan", "value": ["pro"]},
        {"kind": "select", "selector": "#plan", "value": {"label": "Pro"}},
        {"kind": "select", "selector": "#plan", "value": "x" * 1001},
        {"kind": "select", "selector": "#plan", "value": "😀" * 501},
    ],
)
def test_rejects_privileged_or_invalid_actions(action):
    with pytest.raises(ValueError):
        validate_checks([check(actions=[action]), check()])


@pytest.mark.parametrize(
    "value",
    [
        assertion("evaluate", "body", "fetch(secret)"),
        assertion("no-horizontal-overflow", "body", "false"),
        assertion("attribute", "#status", "ready"),
        assertion("attribute", "#status", "ready", attribute=""),
        assertion("attribute", "#status", True, attribute="disabled"),
        assertion("text", "#status", "😀" * 501),
    ],
)
def test_rejects_invalid_assertions(value):
    with pytest.raises(ValueError):
        validate_checks([check(assertions=[value]), check()])


@pytest.mark.parametrize(
    "viewport",
    [
        {"width": 374, "height": 640},
        {"width": 1441, "height": 640},
        {"width": 375, "height": 639},
        {"width": 375, "height": 1201},
        {"width": 375.5, "height": 640},
        {"width": 375},
        {"width": True, "height": 640},
    ],
)
def test_rejects_invalid_viewports(viewport):
    with pytest.raises(ValueError):
        validate_checks([check(viewport=viewport), check()])


def test_normalizes_legacy_and_strict_tool_fields():
    old = {"name": "legacy", "actions": [], "assertion": assertion()}
    strict = {
        "name": "strict",
        "actions": [],
        "assertion": assertion(attribute=None),
        "assertions": None,
        "viewport": None,
    }
    normalized = validate_checks([old, strict])
    assert normalized[0]["viewport"] == {"width": 1280, "height": 720}
    assert normalized[0]["assertion"] == old["assertion"]
    assert normalized[0]["assertions"] == []
    assert normalized[1]["viewport"] is None
    assert normalized[1]["assertions"] == []
    assert "viewport" not in old


@pytest.mark.parametrize("count", [1, 17])
def test_bounds_check_inventory(count):
    with pytest.raises(ValueError):
        validate_checks([check()] * count)


def test_bounds_actions_and_combined_assertions():
    validate_checks(
        [
            check(
                actions=[{"kind": "press", "selector": "#name", "value": "Enter"}] * 16,
                assertions=[assertion()] * 12,
            )
        ]
        * 16
    )
    with pytest.raises(ValueError):
        validate_checks(
            [check(actions=[{"kind": "click", "selector": "#save", "value": None}] * 17)] * 2
        )
    with pytest.raises(ValueError):
        validate_checks([check(assertions=[assertion()] * 12, assertion=assertion())] * 2)
    with pytest.raises(ValueError):
        validate_checks([{"name": "none", "actions": [], "assertions": []}] * 2)


def test_invalid_documents_and_checks_never_allocate_a_browser(monkeypatch):
    def forbidden():
        raise AssertionError("A browser must not be allocated")

    monkeypatch.setattr("formlane.validator.async_playwright", forbidden)
    assert (
        "Return a complete HTML document."
        in validate("<html>unfinished", [check(), check()])["issues"]
    )
    assert validate(HTML, [check(viewport={"width": 1, "height": 1}), check()])["checks"] == []
    assert not validate(HTML, [check(actions=[]), check(actions=[])])["valid"]
    prefix, suffix = "<!doctype html><html>", "</html>"
    available = MAX_PREVIEW_BYTES - len(prefix) - len(suffix)
    html = prefix + "é" * (available // 2) + "x" * (available % 2) + suffix
    issue = f"Artifact exceeds {MAX_PREVIEW_BYTES} UTF-8 bytes."
    assert issue not in validate(html, [])["issues"]
    assert issue in validate(html + "é", [])["issues"]
    assert validate(HTML, [])["artifactHash"] == artifact_hash(HTML)


def test_contained_text_exact_values_and_fresh_contexts():
    report = validate(
        HTML,
        [
            check(
                actions=[
                    {"kind": "fill", "selector": "#name", "value": "Ada"},
                    {"kind": "click", "selector": "#save", "value": None},
                ],
                assertions=[assertion(), assertion("value", "#name", "Ada")],
            ),
            check(
                name="fresh context",
                actions=[],
                assertions=[
                    assertion(expected="Not saved"),
                    assertion("value", "#name", ""),
                    assertion("count", "button", "1"),
                    assertion("attribute", "#status", "ready", attribute="data-state"),
                ],
            ),
        ],
    )
    assert report["issues"] == []
    assert report["valid"]
    assert [item["passed"] for item in report["checks"]] == [True, True]


def test_concurrent_polling_preserves_later_observations():
    report = validate(
        HTML,
        [
            check(
                name="incorrect first expectation",
                actions=[
                    {"kind": "fill", "selector": "#name", "value": "Ada"},
                    {"kind": "click", "selector": "#save", "value": None},
                ],
                assertion=assertion(expected="Deleted"),
                assertions=[
                    assertion(expected="Saved Ada"),
                    assertion("value", "#name", "Ada"),
                    assertion("attribute", "#status", "ready", attribute="data-state"),
                    assertion("count", "button", "1"),
                    assertion("no-horizontal-overflow", "body", "true"),
                ],
            ),
            check(
                name="exact failures",
                actions=[{"kind": "fill", "selector": "#name", "value": "Ada Lovelace"}],
                assertions=[
                    assertion("value", "#name", "Ada"),
                    assertion("attribute", "#status", "read", attribute="data-state"),
                    assertion("count", "button", "0"),
                    assertion(selector="#missing", expected=""),
                ],
            ),
        ],
    )
    assert not report["valid"]
    assert (
        report["checks"][0]["actual"]
        == "1: Saved Ada; 2: Saved Ada; 3: Ada; 4: ready; 5: 1; 6: true"
    )
    assert (
        report["issues"][0]
        == 'incorrect first expectation assertion 1 (text, #status): expected "Deleted", got "Saved Ada".'
    )
    assert len(report["issues"]) == 5
    assert "assertion 4 (text, #missing)" in report["issues"][-1]


def test_boolean_attributes_remain_literal():
    html = '<!doctype html><html><body><button id="empty" disabled>Empty</button><button id="false" disabled="false">False</button><button id="enabled" aria-disabled="false">Enabled</button></body></html>'
    report = validate(
        html,
        [
            check(
                actions=[{"kind": "click", "selector": "#enabled", "value": None}],
                assertions=[
                    assertion("attribute", "#empty", "", attribute="disabled"),
                    assertion("attribute", "#false", "false", attribute="disabled"),
                    assertion("count", "button:disabled", "2"),
                    assertion("count", "#enabled:enabled", "1"),
                ],
            ),
            check(
                name="absent is not false",
                actions=[],
                assertions=[
                    assertion("attribute", "#enabled", "false", attribute="disabled"),
                    assertion("count", "#enabled:enabled", "1"),
                ],
            ),
        ],
    )
    assert [item["passed"] for item in report["checks"]] == [True, False]
    assert report["issues"] == [
        'absent is not false assertion 1 (attribute, #enabled): expected "false", got null.'
    ]


def test_svg_click_keyboard_actions_and_reload():
    html = """<!doctype html><html><body><svg width="100" height="100"><g id="marker" tabindex="0" role="button"><circle cx="30" cy="30" r="20"/></g></svg><output>0</output><script>
const marker = document.querySelector('#marker'); const output = document.querySelector('output');
function activate() { output.textContent = Number(output.textContent) + 1; }
marker.addEventListener('click', activate);
marker.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
</script></body></html>"""
    report = validate(
        html,
        [
            check(
                name="SVG pointer",
                actions=[{"kind": "click", "selector": "#marker", "value": None}],
                assertions=[assertion(selector="output", expected="1")],
            ),
            check(
                name="SVG keyboard",
                actions=[
                    {"kind": "press", "selector": "#marker", "value": "Enter"},
                    {"kind": "press", "selector": "#marker", "value": "Space"},
                ],
                assertions=[assertion(selector="output", expected="2")],
            ),
            check(
                name="reload same srcdoc",
                actions=[
                    {"kind": "click", "selector": "#marker", "value": None},
                    {"kind": "reload", "selector": "body", "value": None},
                ],
                assertions=[assertion(selector="output", expected="0")],
            ),
        ],
    )
    assert report["issues"] == []
    assert report["valid"]


@pytest.mark.parametrize("value", ["", "pro", "x" * 1000, "😀" * 500])
def test_select_accepts_bounded_option_value_strings(value):
    action = {"kind": "select", "selector": "#plan", "value": value}
    normalized = validate_checks([check(actions=[action]), check()])
    assert normalized[0]["actions"] == [action]


def test_native_select_uses_option_values_and_dispatches_change_in_sandbox():
    html = """<!doctype html><html><body>
<select id="plan"><option value="">Choose</option><option value="other">pro</option><option value="pro">Professional</option></select>
<output id="status">unchanged</output><output id="events"></output><output id="sandbox"></output>
<script>
const plan = document.querySelector('#plan');
plan.addEventListener('input', () => { document.querySelector('#events').textContent += 'input;'; });
plan.addEventListener('change', () => {
  document.querySelector('#events').textContent += 'change;';
  document.querySelector('#status').textContent = plan.value === 'pro' ? 'Professional selected' : 'Choose a plan';
  try { parent.document.body; document.querySelector('#sandbox').textContent = 'exposed'; }
  catch { document.querySelector('#sandbox').textContent = 'opaque'; }
});
</script></body></html>"""
    report = validate(
        html,
        [
            check(
                name="select option value rather than matching label",
                actions=[{"kind": "select", "selector": "#plan", "value": "pro"}],
                assertions=[
                    assertion("value", "#plan", "pro"),
                    assertion(expected="Professional selected"),
                    assertion(selector="#events", expected="input;change;"),
                    assertion(selector="#sandbox", expected="opaque"),
                ],
            ),
            check(
                name="select empty placeholder value",
                actions=[
                    {"kind": "select", "selector": "#plan", "value": "pro"},
                    {"kind": "select", "selector": "#plan", "value": ""},
                ],
                assertions=[
                    assertion("value", "#plan", ""),
                    assertion(expected="Choose a plan"),
                    assertion(selector="#events", expected="input;change;input;change;"),
                ],
            ),
            check(
                name="selection does not leak into fresh context",
                actions=[],
                assertions=[assertion("value", "#plan", ""), assertion(expected="unchanged")],
            ),
        ],
    )
    assert report["issues"] == []
    assert report["valid"]
    assert all(item["passed"] for item in report["checks"])


def test_fill_on_native_select_is_not_coerced_to_selection():
    html = '<!doctype html><html><body><select id="plan"><option value="">Choose</option><option value="pro">Professional</option></select></body></html>'
    report = validate(
        html,
        [
            check(
                name="fill remains invalid for select",
                actions=[{"kind": "fill", "selector": "#plan", "value": "pro"}],
                assertions=[assertion("value", "#plan", "pro")],
            ),
            check(
                name="explicit select succeeds",
                actions=[{"kind": "select", "selector": "#plan", "value": "pro"}],
                assertions=[assertion("value", "#plan", "pro")],
            ),
        ],
    )
    assert not report["valid"]
    assert [item["passed"] for item in report["checks"]] == [False, True]
    assert "input" in report["checks"][0]["actual"]


def test_runtime_errors_reject_an_otherwise_matching_document():
    html = '<!doctype html><html><body><button id="save">Save</button><p id="status">Saved</p><script>throw Error("candidate crashed")</script></body></html>'
    report = validate(html, [check(), check(name="second")])
    assert not report["valid"]
    assert all(not item["passed"] for item in report["checks"])
    assert any("candidate crashed" in issue for issue in report["issues"])


def test_opaque_sandbox_and_inherited_policy_block_network():
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    html = f"""<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' data:"></head><body><button id="save">Probe</button><output id="status">ready</output><script>
document.querySelector('#save').onclick = async () => {{
  const flags = [];
  try {{ parent.document.body; }} catch {{ flags.push('parent'); }}
  try {{ localStorage.setItem('owner', 'secret'); }} catch {{ flags.push('storage'); }}
  try {{ document.cookie; }} catch {{ flags.push('cookie'); }}
  if (!window.open('http://127.0.0.1:{port}/popup')) flags.push('popup');
  const requests = [
    fetch('http://127.0.0.1:{port}/fetch').catch(() => flags.push('fetch')),
    // Playwright's offline route closes its socket without emitting an error.
    // Record one result even if a native socket emits both error and close.
    new Promise(resolve => {{
      try {{ const socket = new WebSocket('ws://127.0.0.1:{port}/socket'); socket.onerror = socket.onclose = resolve; }}
      catch {{ resolve(); }}
    }}).then(() => flags.push('socket')),
    new Promise(resolve => {{ const img = new Image(); img.onerror = () => {{ flags.push('image'); resolve(); }}; img.src = 'http://127.0.0.1:{port}/image'; }}),
    new Promise(resolve => {{ try {{ const worker = new Worker('data:text/javascript,postMessage(1)'); worker.onerror = event => {{ event.preventDefault(); flags.push('worker'); resolve(); }}; }} catch {{ flags.push('worker'); resolve(); }} }})
  ];
  await Promise.all(requests);
  document.querySelector('#status').textContent = flags.sort().join(',');
}};
</script></body></html>"""
    try:
        report = validate(
            html,
            [
                check(
                    assertions=[
                        assertion(expected="cookie,fetch,image,parent,popup,socket,storage,worker")
                    ]
                ),
                check(
                    name="fresh opaque context",
                    actions=[],
                    assertions=[assertion(expected="ready")],
                ),
            ],
        )
        assert report["issues"] == []
        assert report["valid"]
        assert requests == []
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_cancellation_interrupts_browser_work():
    started = time.monotonic()
    html = "<!doctype html><html><body><script>while(true){}</script></body></html>"
    with pytest.raises(CancelledError):
        validate_artifact(
            html, [check(), check()], settings(), lambda: time.monotonic() - started > 1
        )
    assert time.monotonic() - started < 12


def test_viewports_drive_real_horizontal_overflow_checks():
    html = '<!doctype html><html><body><button id="save">Probe</button><main style="width:800px"><output id="width"></output></main><script>document.querySelector("#width").textContent=innerWidth</script></body></html>'
    report = validate(
        html,
        [
            check(
                name="mobile overflow",
                viewport={"width": 375, "height": 640},
                assertions=[
                    assertion("no-horizontal-overflow", "body", "true"),
                    assertion(selector="#width", expected="375"),
                ],
            ),
            check(
                name="desktop fits",
                viewport={"width": 1440, "height": 1200},
                actions=[],
                assertions=[
                    assertion("no-horizontal-overflow", "body", "true"),
                    assertion(selector="#width", expected="1440"),
                ],
            ),
        ],
    )
    assert [item["passed"] for item in report["checks"]] == [False, True]
    assert report["issues"] == [
        'mobile overflow assertion 1 (no-horizontal-overflow, body): expected "true", got "false".'
    ]
