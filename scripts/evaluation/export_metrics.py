"""Read-only DBOS 3.5.0 exporter. Execute on the VM in its installed backend venv."""

import argparse
from importlib.metadata import version
import json
import os
from pathlib import Path
import re
import sys
import time
import uuid

from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

STAGE_DATABASE = "formlane_workflow_stage"
STAGE_ORIGIN = "http://127.0.0.1:8094"
ROOT = Path(__file__).resolve().parent
EXPECTED_COLUMNS = {
    "workflow_uuid": "text", "function_id": "integer", "function_name": "text",
    "output": "text", "error": "text", "started_at_epoch_ms": "bigint",
    "completed_at_epoch_ms": "bigint", "serialization": "text",
}


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.open("x", encoding="utf-8") as handle:
        os.chmod(path, 0o600)
        json.dump(value, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def export(args):
    if version("dbos") != "3.5.0":
        raise ValueError("Exporter requires the pinned DBOS version")
    values = dotenv_values(args.env_file, interpolate=False)
    database_url = values.get("DATABASE_URL")
    if not database_url or make_url(database_url).database != STAGE_DATABASE:
        raise ValueError("Production and all other databases are rejected")
    if values.get("DBOS_SYSTEM_SCHEMA", "dbos") != "dbos":
        raise ValueError("Exporter requires the inspected dbos schema")
    manifest = json.loads(args.runs.read_text()) if args.runs else None
    run_ids = []
    if manifest:
        if manifest.get("database") != STAGE_DATABASE:
            raise ValueError("Run manifest is not for staging")
        for row in manifest["runs"]:
            uuid.UUID(row["runId"])
            uuid.UUID(row["projectId"])
            run_ids.append(row["runId"])
        if len(run_ids) != len(set(run_ids)):
            raise ValueError("Duplicate run identities")
    engine = create_engine(database_url, echo=False, hide_parameters=True)
    try:
        with engine.connect() as connection, connection.begin():
            connection.exec_driver_sql("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
            connection.exec_driver_sql("SET LOCAL statement_timeout = '30s'")
            actual_database = connection.execute(text("SELECT current_database()")).scalar_one()
            if actual_database != STAGE_DATABASE:
                raise ValueError("Connected database is not staging")
            columns = dict(connection.execute(text(
                "SELECT column_name,data_type FROM information_schema.columns "
                "WHERE table_schema='dbos' AND table_name='operation_outputs'"
            )).all())
            if any(columns.get(key) != value for key, value in EXPECTED_COLUMNS.items()):
                raise ValueError("DBOS schema differs from the inspected pinned schema")
            target = {"database": actual_database, "apiOrigin": STAGE_ORIGIN,
                      "dbosVersion": "3.5.0", "capturedAt": int(time.time() * 1000),
                      "readOnly": connection.execute(text("SHOW transaction_read_only")).scalar_one() == "on"}
            if not target["readOnly"]:
                raise ValueError("Read-only transaction is required")
            if args.probe:
                save(args.output, target)
                return
            if manifest is None or not run_ids:
                raise ValueError("A nonempty run manifest is required for export")
            params = {"run_ids": run_ids}
            rows = connection.execute(text(
                "SELECT r.id,r.project_id,r.status,r.attempt,r.created_at,r.started_at,r.finished_at,"
                "r.event_cursor,r.version_id,r.execution_version, w.status AS dbos_status,w.name AS workflow_name "
                "FROM public.runs r LEFT JOIN dbos.workflow_status w ON w.workflow_uuid=r.id "
                "WHERE r.id=ANY(CAST(:run_ids AS text[])) ORDER BY r.created_at,r.id"
            ), params).mappings().all()
            expected = {row["runId"]: row["projectId"] for row in manifest["runs"]}
            if {row["id"]: row["project_id"] for row in rows} != expected:
                raise ValueError("Run/project identities do not match this staging database")
            if any(row["execution_version"] != "flow-v1" or row["workflow_name"] not in {None, "formlane.flow.v1"} for row in rows):
                raise ValueError("Evaluation contains an incompatible workflow")
            stages = connection.execute(text((ROOT / "stages.sql").read_text()), params).mappings().all()
            # Metadata only: do not load or deserialize provider output/pickle blobs.
            operations = connection.execute(text(
                "SELECT workflow_uuid AS run_id,function_id,function_name,started_at_epoch_ms,"
                "completed_at_epoch_ms,serialization,(error IS NULL AND output IS NOT NULL) AS committed "
                "FROM dbos.operation_outputs WHERE workflow_uuid=ANY(CAST(:run_ids AS text[])) "
                "ORDER BY workflow_uuid,function_id"
            ), params).mappings().all()
            events = connection.execute(text(
                "SELECT run_id,sequence,attempt,type,created_at, "
                "CASE WHEN type IN ('tool_start','tool_end') THEN data->>'id' END AS operation_id, "
                "CASE WHEN type IN ('tool_start','tool_end') THEN data->>'name' END AS tool_name, "
                "CASE WHEN type='tool_end' AND data->>'name'='record_review' "
                "THEN data->'output'->'accepted' END AS accepted "
                "FROM public.run_events WHERE run_id=ANY(CAST(:run_ids AS text[])) "
                "AND (type IN ('file_start','file_delta','file_saved','repair') "
                "OR (type='tool_end' AND data->>'name'='record_review')) ORDER BY run_id,sequence"
            ), params).mappings().all()
            counts = dict(connection.execute(text(
                "SELECT run_id,count(*) FROM public.run_events "
                "WHERE run_id=ANY(CAST(:run_ids AS text[])) GROUP BY run_id"
            ), params).all())
            exported = []
            for row in rows:
                run_id = row["id"]
                run_stages = [dict(stage) for stage in stages if stage["run_id"] == run_id]
                run_operations = [dict(op) for op in operations if op["run_id"] == run_id]
                run_events = [dict(event) for event in events if event["run_id"] == run_id]
                committed = [op for op in run_operations if op["committed"]]
                first = next((event for event in run_events if event["type"] in {"file_start", "file_delta", "file_saved"}), None)
                first_saved = next((event for event in run_events if event["type"] == "file_saved"), None)
                repair_stages = [stage["stage"] for stage in run_stages if re.fullmatch(r"(?:review-)?repair-\d+", stage["stage"]) and stage["committed_model_calls"]]
                review_stages = [stage["stage"] for stage in run_stages if re.fullmatch(r"review-\d+", stage["stage"]) and stage["committed_model_calls"]]
                exported.append({
                    "runId": run_id, "projectId": row["project_id"], "status": row["status"], "attempt": row["attempt"],
                    "versionId": row["version_id"], "dbosStatus": row["dbos_status"], "executionVersion": row["execution_version"],
                    "createdAt": row["created_at"], "startedAt": row["started_at"], "finishedAt": row["finished_at"],
                    "eventCount": counts.get(run_id, 0), "terminalCursor": row["event_cursor"],
                    "firstFileMs": first["created_at"] - row["created_at"] if first else None,
                    "firstFileEvent": first["type"] if first else None,
                    "firstSavedFileMs": first_saved["created_at"] - row["created_at"] if first_saved else None,
                    "totalMs": row["finished_at"] - row["created_at"] if row["finished_at"] is not None else None,
                    "committedModelCalls": sum(bool(re.search(r"/llm-\d+$", op["function_name"])) for op in committed),
                    "committedRepairStages": repair_stages, "committedReviewStages": review_stages,
                    "committedReviewOperations": sum(bool(re.search(r"/tool-\d+-record_review$", op["function_name"])) for op in committed),
                    "repairNoticeCount": sum(event["type"] == "repair" for event in run_events),
                    "reviewEvents": [event for event in run_events if event["tool_name"] == "record_review"],
                    "stages": run_stages, "operations": run_operations,
                    "recordedUsage": None, "recordedCost": None,
                    "usageUnavailableReason": "This workflow persists model response content but no structured provider usage or billed cost. No token estimate or price is substituted.",
                })
            save(args.output, {"schemaVersion": 1, "target": target, "runs": exported})
    finally:
        engine.dispose()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True, help="Private staging service environment, never a production env file")
    parser.add_argument("--runs", type=Path, help="Sanitized run-ids.json from macmini2")
    parser.add_argument("--probe", action="store_true", help="Export only read-only database/schema target proof")
    parser.add_argument("--output", type=Path, required=True, help="New private JSON file; refuses overwrite")
    args = parser.parse_args()
    if args.probe == bool(args.runs):
        parser.error("Choose exactly one of --probe or --runs")
    try:
        export(args)
    except Exception as error:
        # SQLAlchemy/driver errors can embed DSNs or SQL values. Never print them.
        print(f"Read-only staging export failed ({type(error).__name__}). No credentials emitted.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
