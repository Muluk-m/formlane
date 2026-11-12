import json
import os
import sys
import time
from concurrent.futures import CancelledError
from pathlib import Path
from types import SimpleNamespace

import pytest

from formlane.compiler import compile_project, safe_environment
from formlane.project import create_source, legacy_source, source_hash
from formlane.validator import validate_artifact

COMPILER = Path(__file__).resolve().parents[2] / "compiler" / "dist" / "index.js"


def settings(command=None):
    return SimpleNamespace(
        compiler_command=json.dumps(command or ["node", str(COMPILER)]),
        browser_executable=os.environ.get("BROWSER_EXECUTABLE_PATH"),
    )


def counter_checks():
    return [
        {
            "name": "Initial state",
            "actions": [],
            "assertion": {"selector": "output", "kind": "text", "expected": "0"},
        },
        {
            "name": "State update",
            "actions": [{"kind": "click", "selector": "button", "value": None}],
            "assertion": {"selector": "output", "kind": "text", "expected": "1"},
        },
    ]


@pytest.mark.parametrize("template", ["vanilla", "react-ts"])
def test_compiles_and_runs_real_multifile_sources(template):
    source = create_source(template)
    if template == "react-ts":
        source["files"]["src/App.tsx"] = (
            "import Counter from './Counter'; export default function App() { return <main><Counter /></main> }"
        )
        source["files"]["src/Counter.tsx"] = (
            "import { useState } from 'react'; export default function Counter() { const [n,setN] = useState(0); return <><output>{n}</output><button onClick={() => setN(n+1)}>Increase</button></> }"
        )
    else:
        source["files"]["src/counter.js"] = "export const next = n => n + 1"
        source["files"]["src/main.js"] = (
            "import './styles.css'; import {next} from './counter.js'; document.querySelector('#root').innerHTML='<output>0</output><button>Increase</button>'; document.querySelector('button').onclick=()=>{const out=document.querySelector('output');out.textContent=String(next(Number(out.textContent)))}"
        )
    result = compile_project(source, settings(), lambda: False)
    assert result["sourceHash"] == source_hash(source)
    report = validate_artifact(result["html"], counter_checks(), settings(), lambda: False)
    assert report["issues"] == []
    assert report["valid"]


def test_preserves_legacy_inline_scripts():
    source = legacy_source(
        "<!doctype html><html><body><output>0</output><button onclick=\"document.querySelector('output').textContent='1'\">Increase</button></body></html>"
    )
    result = compile_project(source, settings(), lambda: False)
    assert validate_artifact(result["html"], counter_checks(), settings(), lambda: False)["valid"]


@pytest.mark.parametrize(
    "specifier",
    [
        "node:fs",
        "/etc/private.js",
        "../../outside.js",
        "https://example.com/module.js",
        "some-package",
        "./styles.css?bad",
    ],
)
def test_rejects_external_or_unsupported_imports(specifier):
    source = create_source("vanilla")
    source["files"]["src/main.js"] = f"import {json.dumps(specifier)}"
    with pytest.raises(ValueError, match="compilation failed"):
        compile_project(source, settings(), lambda: False)


def test_generated_configuration_is_data_not_host_code(tmp_path):
    marker = tmp_path / "executed"
    source = create_source("vanilla")
    source["files"]["vite.config.js"] = (
        f"import {{writeFileSync}} from 'node:fs';writeFileSync({json.dumps(str(marker))},'executed');throw Error('configuration executed')"
    )
    source["files"]["tsconfig.json"] = (
        '{"extends":"/etc/secret.json","compilerOptions":{"plugins":[{"name":"untrusted"}]}}'
    )
    compile_project(source, settings(), lambda: False)
    assert not marker.exists()


def test_compiler_handles_local_assets_and_raw_queries():
    source = create_source("vanilla")
    source["files"]["src/icon.svg"] = (
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
    )
    source["files"]["src/text.txt"] = "literal content"
    source["files"]["src/main.js"] = (
        "import icon from './icon.svg?url'; import text from './text.txt?raw'; document.querySelector('#root').innerHTML='<img alt=mark><p></p>'; document.querySelector('img').src=icon; document.querySelector('p').textContent=text"
    )
    result = compile_project(source, settings(), lambda: False)
    assert "data:image/svg+xml" in result["html"]
    assert "literal content" in result["html"]


def test_broken_modules_never_return_an_old_preview():
    source = create_source("vanilla")
    source["files"]["src/main.js"] = "const missing = ;"
    with pytest.raises(ValueError, match="compilation failed"):
        compile_project(source, settings(), lambda: False)


def test_environment_excludes_secrets_and_injection(monkeypatch):
    for name in (
        "DATABASE_URL",
        "OPENAI_API_KEY",
        "NODE_OPTIONS",
        "PYTHONPATH",
        "EXECUTOR_TOKEN",
        "AWS_SECRET_ACCESS_KEY",
    ):
        monkeypatch.setenv(name, "secret")
    assert not set(safe_environment()) - {"HOME", "PATH", "TMPDIR", "LANG"}


def test_cancellation_prevents_process_start():
    with pytest.raises(CancelledError):
        compile_project(create_source("vanilla"), settings(["/does/not/exist"]), lambda: True)


def test_rejects_mismatched_compiler_hash():
    script = "import sys,json;json.load(sys.stdin);print(json.dumps({'html':'<!doctype html><html></html>','sourceHash':'wrong'}))"
    with pytest.raises(ValueError, match="hash does not match"):
        compile_project(
            create_source("vanilla"), settings([sys.executable, "-c", script]), lambda: False
        )


def test_cancellation_kills_compiler_descendants(tmp_path):
    descendant = tmp_path / "descendant.pid"
    child = f"import os,signal,time;from pathlib import Path;signal.signal(signal.SIGTERM,signal.SIG_IGN);Path({str(descendant)!r}).write_text(str(os.getpid()));time.sleep(60)"
    script = f"import subprocess,sys,time;subprocess.Popen([sys.executable,'-c',{child!r}],start_new_session=True);time.sleep(60)"
    started = time.monotonic()
    with pytest.raises(CancelledError):
        compile_project(
            create_source("vanilla"),
            settings([sys.executable, "-c", script]),
            lambda: (
                (descendant.exists() and descendant.stat().st_size > 0)
                or time.monotonic() - started > 5
            ),
        )
    assert descendant.exists()
    pid = int(descendant.read_text())
    # A killed child may briefly remain a zombie until adopted/reaped by init.
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        try:
            stat = Path(f"/proc/{pid}/stat")
            if stat.exists() and stat.read_text().split()[2] == "Z":
                return
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.01)
    pytest.fail("Detached compiler descendant survived cancellation")


def test_compiler_timeout_is_bounded(monkeypatch):
    monkeypatch.setattr("formlane.compiler.COMPILER_TIMEOUT_SECONDS", 0.2)
    with pytest.raises(TimeoutError, match="timed out"):
        compile_project(
            create_source("vanilla"),
            settings([sys.executable, "-c", "import time;time.sleep(60)"]),
            lambda: False,
        )


def test_compiler_stdout_is_bounded():
    script = (
        "import sys;sys.stdin.read();sys.stdout.write('x' * (5 * 1024 * 1024));sys.stdout.flush()"
    )
    with pytest.raises(ValueError, match="output limit"):
        compile_project(
            create_source("vanilla"), settings([sys.executable, "-c", script]), lambda: False
        )
