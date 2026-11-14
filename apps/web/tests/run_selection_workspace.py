"""Run deterministic workspace browser cases against an isolated real API and built web app.

Uses the existing PostgreSQL fixture seam; no worker or model provider is started.
Native capture and real-provider acceptance remain separately configured scenarios.
"""

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from uuid import uuid4

import httpx
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps/backend/tests"))

from formlane.compiler import compile_project
from formlane.project import legacy_source
from formlane.settings import Settings
from test_storage import complete, postgres_store


def stop(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def ready(process, url, logs):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Fixture service exited; private logs: {logs}")
        try:
            if httpx.get(url, timeout=1).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise RuntimeError(f"Fixture service did not become ready; private logs: {logs}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-port", type=int, default=8108)
    parser.add_argument("--web-port", type=int, default=5198)
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Exercise the development StrictMode lifecycle",
    )
    parser.add_argument("--pytest-args", nargs=argparse.REMAINDER, default=[])
    args = parser.parse_args()
    database = os.environ.get("TEST_DATABASE_URL", "")
    if not database or not re.fullmatch(
        r"formlane(?:_[a-z0-9]+)*_test", make_url(database).database or ""
    ):
        raise SystemExit(
            "TEST_DATABASE_URL must name a dedicated formlane*_test database"
        )
    api_origin = f"http://127.0.0.1:{args.api_port}"
    web_origin = f"http://127.0.0.1:{args.web_port}"
    env = {
        key: os.environ[key]
        for key in (
            "PATH",
            "HOME",
            "LANG",
            "LC_ALL",
            "TMPDIR",
            "TEMP",
            "TMP",
            "CI",
            "BROWSER_EXECUTABLE_PATH",
            "DISPLAY",
            "XAUTHORITY",
            "FORMLANE_SELECTION_NATIVE_CAPTURE",
            "FORMLANE_SELECTION_CAPTURE_BROWSER_ARGS",
        )
        if key in os.environ
    }
    env.update(
        {
            "VITE_API_ORIGIN": api_origin,
            "VITE_API_PUBLIC_ORIGIN": web_origin,
            "PYTHONPATH": str(ROOT / "apps/backend/src"),
            "OTEL_SDK_DISABLED": "true",
            "CREWAI_TELEMETRY_ENABLED": "false",
        }
    )
    if not args.dev:
        subprocess.run(
            ["pnpm", "--filter", "@atoms-demo/web", "build"],
            cwd=ROOT,
            env=env,
            check=True,
        )
    logs = Path(tempfile.mkdtemp(prefix="formlane-selection-workspace-"))
    print(f"Private fixture service logs: {logs}", flush=True)
    with postgres_store() as store:
        settings = Settings(
            _env_file=None,
            database_url=store.engine.url.render_as_string(hide_password=False),
            compiler_command=json.dumps(
                ["node", str(ROOT / "apps/compiler/dist/index.js")]
            ),
        )
        source = legacy_source(
            (ROOT / "apps/web/tests/fixtures/selection-scene.html").read_text()
        )
        compiled = compile_project(source, settings, lambda: False)
        owner = str(uuid4())
        project = store.create_project(owner, "Selection workspace fixture")
        result = {
            "source": source,
            "html": compiled["html"],
            "summary": "Deterministic browser fixture",
        }
        first = complete(store, project, owner, result)
        second = complete(store, project, owner, result)
        version = store.get_version(project["id"], owner, second["id"])["version"]
        if version["parentVersionId"] != first["id"]:
            raise RuntimeError("Fixture must have real generation ancestry")
        env.update(
            {
                "DATABASE_URL": settings.database_url,
                "COMPILER_COMMAND": settings.compiler_command,
                "ALLOWED_ORIGINS": web_origin,
                "PUBLIC_ORIGIN": web_origin,
                # Enables the composer for intercepted transport-fault tests. No worker runs.
                "OPENAI_API_KEY": "isolated-fixture-no-provider",
                "ENDPOINT": "http://127.0.0.1:1",
                "WORKER_ENABLED": "true",
                "FORMLANE_SELECTION_PROJECT_URL": f"{web_origin}/project/{project['id']}",
                "FORMLANE_SELECTION_OWNER": owner,
            }
        )
        services = []
        try:
            for name, command, url in (
                (
                    "api",
                    [
                        sys.executable,
                        "-m",
                        "uvicorn",
                        "formlane.app:create_app",
                        "--factory",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(args.api_port),
                        "--no-access-log",
                    ],
                    f"{api_origin}/healthz",
                ),
                (
                    "web",
                    [
                        "pnpm",
                        "--filter",
                        "@atoms-demo/web",
                        "dev" if args.dev else "preview",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(args.web_port),
                        "--strictPort",
                    ],
                    web_origin,
                ),
            ):
                log_path = logs / f"{name}.log"
                with log_path.open("w") as output:
                    log_path.chmod(0o600)
                    process = subprocess.Popen(
                        command,
                        cwd=ROOT,
                        env=env,
                        stdout=output,
                        stderr=subprocess.STDOUT,
                        start_new_session=True,
                    )
                services.append(process)
                ready(process, url, logs)
            test_env = {
                key: value
                for key, value in env.items()
                if key not in {"DATABASE_URL", "OPENAI_API_KEY", "ENDPOINT"}
            }
            subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    "apps/web/tests/test_selection_workspace.py",
                    *args.pytest_args,
                ],
                cwd=ROOT,
                env=test_env,
                check=True,
            )
        finally:
            for process in reversed(services):
                stop(process)


if __name__ == "__main__":
    main()
