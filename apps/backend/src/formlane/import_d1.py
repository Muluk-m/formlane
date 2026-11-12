"""Faithful offline D1 import into an empty, explicitly migrated PostgreSQL DB.

Input: Wrangler `d1 export ... --output snapshot.sql`, or one UTF-8 JSON object
mapping all six table names to arrays of raw D1 rows (messages in rowid order).
SQL is decoded in an isolated in-memory SQLite connection, never used as runtime
storage. The command performs no network access to D1 and no request-time schema
changes. Drain legacy writers before the final export; rehearsal targets must be
separate databases. An identical repeat is accepted; divergent targets fail.
Pre-0006 exports are accepted: missing version parents are recovered only from
the originating same-project run and a retained same-project previous version.
Unknown/remix ancestry remains null; existing explicit parents are never rewritten.

    DATABASE_URL=... python -m formlane.import_d1 snapshot.sql --manifest report.json
    DATABASE_URL=... python -m formlane.import_d1 snapshot.sql --verify-only
"""

import argparse
import hashlib
import json
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Any

from sqlalchemy import insert, select, text

from .models import Message, Project, Run, RunCheckpoint, RunEvent, Version
from .project import artifact_hash, source_hash, validate_source
from .settings import Settings
from .storage import Store

TABLES = {
    "projects": Project.__table__,
    "messages": Message.__table__,
    "versions": Version.__table__,
    "runs": Run.__table__,
    "run_events": RunEvent.__table__,
    "run_checkpoints": RunCheckpoint.__table__,
}
EXTRA_COLUMNS = {
    "messages": {"position"},
    "runs": {
        "event_cursor",
        "attempt",
        "attempt_started_at",
        "execution_version",
        "recovery_eligible",
    },
    "run_events": {"attempt"},
}
JSON_COLUMNS = {"versions": {"source"}, "run_events": {"data"}, "run_checkpoints": {"result"}}
KEYS = {name: tuple(column.name for column in table.primary_key) for name, table in TABLES.items()}


class ImportConflict(ValueError):
    pass


def canonical(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def read_export(path: Path) -> dict[str, list[dict]]:
    with path.open(encoding="utf-8-sig", newline="") as stream:
        source = stream.read()
    if path.suffix.lower() == ".json":
        payload = json.loads(source)
    else:
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row

        # A dump must not attach/read/write another filesystem database or load extensions.
        def authorize(action, arg1, arg2, _database, _trigger):
            if action in {sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH}:
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_FUNCTION and (arg2 or "").lower() in {
                "load_extension",
                "readfile",
                "writefile",
            }:
                return sqlite3.SQLITE_DENY
            return sqlite3.SQLITE_OK

        connection.set_authorizer(authorize)
        try:
            connection.executescript(source)
            payload = {}
            for name in TABLES:
                # Fixed identifiers only; preserve D1 rowid order for tied message timestamps.
                payload[name] = [
                    dict(row)
                    for row in connection.execute(f'SELECT * FROM "{name}" ORDER BY rowid')
                ]
        finally:
            connection.close()
    return normalize_export(payload)


def normalize_export(payload: Any, *, decode_json: bool = True) -> dict[str, list[dict]]:
    if not isinstance(payload, dict) or set(payload) != set(TABLES):
        raise ValueError("Export must contain exactly all six D1 business tables.")
    normalized = {}
    for name, table in TABLES.items():
        rows = payload[name]
        if not isinstance(rows, list):
            raise ValueError(f"{name} must be an array of rows.")
        columns = set(table.columns.keys()) - EXTRA_COLUMNS.get(name, set())
        normalized[name] = []
        identities = set()
        for original in rows:
            legacy_version = (
                name == "versions"
                and isinstance(original, dict)
                and set(original) == columns - {"parent_version_id"}
            )
            legacy_run = (
                name == "runs"
                and isinstance(original, dict)
                and set(original) == columns | {"deadline_at"}
            )
            if not isinstance(original, dict) or (
                set(original) != columns and not legacy_version and not legacy_run
            ):
                raise ValueError("Export columns do not match the supported D1 schema.")
            row = dict(original)
            if legacy_run:
                row.pop("deadline_at")
            for column in JSON_COLUMNS.get(name, set()):
                # Raw D1 rows encode JSON columns as text. Decode exactly once.
                if decode_json and isinstance(row[column], str):
                    try:
                        row[column] = json.loads(row[column])
                    except json.JSONDecodeError:
                        raise ValueError(f"Invalid JSON in {name}.{column}.") from None
            identity = tuple(row[column] for column in KEYS[name])
            if identity in identities:
                raise ValueError(f"Duplicate identity in {name}.")
            identities.add(identity)
            canonical(row)
            normalized[name].append(row)
    versions = {row["id"]: row for row in normalized["versions"]}
    runs = {row["id"]: row for row in normalized["runs"]}
    for version in versions.values():
        if "parent_version_id" in version:
            continue
        origin = runs.get(version["id"])
        parent = versions.get(origin["previous_version_id"]) if origin else None
        version["parent_version_id"] = (
            parent["id"]
            if origin
            and parent
            and origin["project_id"] == version["project_id"] == parent["project_id"]
            else None
        )
    validate_export(normalized)
    return normalized


def validate_export(data: dict[str, list[dict]]) -> None:
    projects = {row["id"]: row for row in data["projects"]}
    versions = {row["id"]: row for row in data["versions"]}
    runs = {row["id"]: row for row in data["runs"]}
    for name in ("messages", "versions", "runs"):
        if any(row["project_id"] not in projects for row in data[name]):
            raise ValueError(f"Orphan row in {name}.")
    for row in data["versions"]:
        validate_source(row["source"])
        parent = row["parent_version_id"]
        if parent is not None and (
            parent not in versions or versions[parent]["project_id"] != row["project_id"]
        ):
            raise ValueError("Version parent must belong to the same project.")
    for row in data["runs"]:
        if row["status"] not in {"completed", "failed", "cancelled"}:
            raise ValueError(
                "Drain or explicitly cancel all legacy runs before export; active runs cannot be imported."
            )
        for field in ("previous_version_id", "version_id"):
            value = row[field]
            if value is not None and (
                value not in versions or versions[value]["project_id"] != row["project_id"]
            ):
                raise ValueError("Run version pointer is not in its project.")
    for row in data["projects"]:
        if row["run_id"] is not None or row["status"] == "generating":
            raise ValueError(
                "Legacy project still has active generation state; drain writers before export."
            )
        for field in ("current_version_id", "published_version_id"):
            value = row[field]
            if value is not None and (
                value not in versions or versions[value]["project_id"] != row["id"]
            ):
                raise ValueError("Project version pointer is invalid.")
        if bool(row["published_slug"]) != bool(row["published_version_id"]):
            raise ValueError("Published slug and version must be set together.")
    for name in ("run_events", "run_checkpoints"):
        if any(row["run_id"] not in runs for row in data[name]):
            raise ValueError(f"Orphan row in {name}.")
    for row in data["run_events"]:
        if (
            not isinstance(row["data"], dict)
            or type(row["sequence"]) is not int
            or row["sequence"] <= 0
        ):
            raise ValueError("Invalid event data or sequence.")


def manifest(data: dict[str, list[dict]]) -> dict:
    tables = {}
    for name, rows in data.items():
        ordered = sorted(rows, key=lambda row: tuple(row[key] for key in KEYS[name]))
        tables[name] = {
            "count": len(rows),
            "sha256": hashlib.sha256(canonical(ordered)).hexdigest(),
        }
    # Timestamp ties must preserve D1 rowid order, independently of row hashes.
    order = defaultdict(list)
    for row in data["messages"]:
        order[(row["project_id"], row["created_at"])].append(row["id"])
    message_order = [[project, created, ids] for (project, created), ids in sorted(order.items())]
    return {
        "format": 1,
        "tables": tables,
        "artifacts": {
            row["id"]: {
                "sourceHash": source_hash(row["source"]),
                "htmlHash": artifact_hash(row["html"]),
            }
            for row in sorted(data["versions"], key=lambda row: row["id"])
        },
        "ancestryPolicy": "Preserve explicit parents; when parent_version_id is absent, apply D1 0006: recover only from the originating same-project run and retained same-project previous version; unknown/remix roots remain null.",
        "messageOrderSha256": hashlib.sha256(canonical(message_order)).hexdigest(),
    }


def import_data(store: Store, data: dict[str, list[dict]], *, verify_only: bool = False) -> dict:
    # Callers supplying a decoded object receive the same preflight checks as the CLI.
    data = normalize_export(data, decode_json=False)
    expected = manifest(data)
    with store.engine.begin() as connection:
        connection.execute(
            text(
                "LOCK TABLE projects, messages, versions, runs, run_events, run_checkpoints IN ACCESS EXCLUSIVE MODE"
            )
        )
        existing = read_target(connection)
        has_rows = any(existing.values())
        if verify_only or has_rows:
            if manifest(existing) != expected:
                raise ImportConflict(
                    "Target differs from the export. Use an empty staging/final database; snapshots are never merged or overwritten."
                )
            verify_cursors(connection, data)
            return {**expected, "verified": True, "inserted": False}
        cursor = defaultdict(int)
        for event in data["run_events"]:
            cursor[event["run_id"]] = max(cursor[event["run_id"]], event["sequence"])
        for name, table in TABLES.items():
            rows = data[name]
            if name == "runs":
                projects = {project["id"]: project for project in data["projects"]}
                rows = [
                    {
                        **row,
                        "event_cursor": cursor[row["id"]],
                        "attempt": 1,
                        "attempt_started_at": row["created_at"],
                        "execution_version": "crew-v1",
                        "recovery_eligible": (
                            projects[row["project_id"]]["run_id"] in {None, row["id"]}
                            and projects[row["project_id"]]["current_version_id"]
                            == row["previous_version_id"]
                            and row["status"] != "completed"
                            and not any(
                                other["project_id"] == row["project_id"]
                                and other["id"] != row["id"]
                                and other["created_at"] >= row["created_at"]
                                for other in rows
                            )
                            and not any(
                                message["project_id"] == row["project_id"]
                                and message["role"] == "system"
                                and message["content"].startswith("Restored version ")
                                and message["content"].endswith(".")
                                and message["created_at"] >= row["created_at"]
                                for message in data["messages"]
                            )
                        ),
                    }
                    for row in rows
                ]
            # Message identity allocation follows the D1 export order even for timestamp ties.
            for row in rows:
                connection.execute(insert(table).values(**row))
        connection.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
        actual = read_target(connection)
        if manifest(actual) != expected:
            raise ImportConflict("Import verification failed; transaction rolled back.")
        verify_cursors(connection, data)
        return {**expected, "verified": True, "inserted": True}


def read_target(connection) -> dict[str, list[dict]]:
    data = {}
    for name, table in TABLES.items():
        columns = [
            column for column in table.columns if column.name not in EXTRA_COLUMNS.get(name, set())
        ]
        query = select(*columns)
        if name == "messages":
            query = query.order_by(table.c.position)
        data[name] = [dict(row) for row in connection.execute(query).mappings()]
    return data


def verify_cursors(connection, data: dict[str, list[dict]]) -> None:
    cursors = defaultdict(int)
    for row in data["run_events"]:
        cursors[row["run_id"]] = max(cursors[row["run_id"]], row["sequence"])
    for run_id, actual in connection.execute(select(Run.id, Run.event_cursor)):
        if actual != cursors[run_id]:
            raise ImportConflict("Run cursor does not match the retained event history.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export", type=Path)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    store = Store(Settings().database_url)
    try:
        report = import_data(store, read_export(args.export), verify_only=args.verify_only)
        rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
        if args.manifest:
            args.manifest.write_text(rendered, encoding="utf-8")
        print(rendered, end="")
    except (ValueError, sqlite3.Error) as error:
        parser.exit(1, f"Import rejected: {error}\n")
    finally:
        store.close()


if __name__ == "__main__":
    main()
