#!/usr/bin/env python3
"""Provision isolated local PostgreSQL databases without exposing credentials."""

import json
import os
import secrets
import shlex
import subprocess
from pathlib import Path

ENV_PATH = Path("/etc/formlane/backend-stage.env")
ROLE = "formlane_python"
DATABASES = ("formlane_stage", "formlane_test", "formlane")


def psql(statement: str) -> str:
    result = subprocess.run(
        ["runuser", "-u", "postgres", "--", "psql", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-At"],
        input=statement,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("PostgreSQL provisioning failed; credentials were not printed.")
    return result.stdout.strip()


def parse_env(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if separator:
            parsed = shlex.split(value)
            values[key.strip()] = parsed[0] if parsed else ""
    return values


def main() -> None:
    if os.geteuid() != 0:
        raise RuntimeError("Run as root.")
    os.umask(0o077)
    existing_role = psql(f"SELECT 1 FROM pg_roles WHERE rolname = '{ROLE}';") == "1"
    if not ENV_PATH.exists():
        if existing_role:
            raise RuntimeError(
                "Existing role has no managed environment file; refusing password replacement."
            )
        legacy = parse_env(Path("/etc/formlane/executor.env"))
        password = secrets.token_urlsafe(36)
        values = {
            "DATABASE_URL": f"postgresql+psycopg://{ROLE}:{password}@127.0.0.1:5432/formlane_stage",
            "TEST_DATABASE_URL": f"postgresql+psycopg://{ROLE}:{password}@127.0.0.1:5432/formlane_test",
            "OPENAI_API_KEY": legacy.get("OPENAI_API_KEY", ""),
            "ENDPOINT": legacy.get("ENDPOINT", ""),
            "MODEL": legacy.get("MODEL", ""),
            "ALLOWED_ORIGINS": "http://127.0.0.1:5193,http://localhost:5193,https://formlane-9dp.pages.dev",
            "PUBLIC_ORIGIN": "http://127.0.0.1:8090",
            "BROWSER_EXECUTABLE_PATH": "/usr/bin/chromium",
            "COMPILER_COMMAND": json.dumps(
                [
                    "/usr/local/bin/node",
                    "/opt/formlane/python-backend/current/apps/compiler/dist/index.js",
                ]
            ),
            "WORKER_ENABLED": "true",
            "CREWAI_TELEMETRY_ENABLED": "false",
            "OTEL_SDK_DISABLED": "true",
            "UV_CACHE_DIR": "/var/lib/formlane/python/uv-cache",
        }
        if not all(values[key] for key in ("OPENAI_API_KEY", "ENDPOINT", "MODEL")):
            raise RuntimeError("Legacy provider configuration is incomplete.")
        ENV_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = ENV_PATH.with_suffix(".env.tmp")
        temporary.write_text(
            "".join(f"{key}={json.dumps(value)}\n" for key, value in values.items())
        )
        temporary.chmod(0o600)
        temporary.replace(ENV_PATH)
    values = parse_env(ENV_PATH)
    password = values["DATABASE_URL"].split(":", 2)[2].split("@", 1)[0]
    if not existing_role:
        # Password is generated URL-safe ASCII and passed on stdin, never in argv or logs.
        if not all(character.isalnum() or character in "-_" for character in password):
            raise RuntimeError("Unexpected managed credential format.")
        psql(f"CREATE ROLE {ROLE} LOGIN PASSWORD '{password}' NOSUPERUSER NOCREATEDB NOCREATEROLE;")
    for database in DATABASES:
        owner = psql(
            f"SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '{database}';"
        )
        if owner and owner != ROLE:
            raise RuntimeError(f"Refusing existing database owned by another role: {database}")
        if not owner:
            subprocess.run(
                [
                    "runuser",
                    "-u",
                    "postgres",
                    "--",
                    "createdb",
                    "--owner",
                    ROLE,
                    "--encoding=UTF8",
                    database,
                ],
                check=True,
            )
    print("Managed PostgreSQL role and stage/test/production databases are ready.")


if __name__ == "__main__":
    main()
