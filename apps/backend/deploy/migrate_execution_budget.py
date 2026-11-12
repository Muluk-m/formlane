"""One-off, hash-pinned migration for the reviewed execution-budget change.

Stop the API and worker and back up both PostgreSQL schemas before --apply.
Run with PYTHONPATH pointing at the accepted candidate's src directory.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path

from dbos._serialization import DefaultSerializer
from sqlalchemy import create_engine, text

from formlane.durable_execution import compatibility_manifest
from formlane.settings import Settings

PREVIOUS_SOURCE = "3e9c507a767d77551a9d0d00293c1e38c43686d771d7c13f4058546a66c45567"
ACCEPTED_SOURCE = "dd925e141f35b719b18f5888c84e089349afd4c662ae3dca1931e0347af7c5fb"
NAME = "dbos-v1/execution-manifest"


def source_hash(manifest: dict) -> str:
    return hashlib.sha256(json.dumps(manifest["source"], sort_keys=True).encode()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    values = {
        key: json.loads(value)
        for key, value in (
            line.split("=", 1)
            for line in args.env_file.read_text().splitlines()
            if line and not line.startswith("#")
        )
    }
    os.environ.update(values)
    settings = Settings()
    target = compatibility_manifest(settings)
    if source_hash(target) != ACCEPTED_SOURCE:
        raise SystemExit("Candidate differs from the reviewed execution change.")
    serializer = DefaultSerializer()
    engine = create_engine(settings.database_url)
    schema = settings.dbos_system_schema
    migrated, unchanged = [], []
    try:
        with engine.begin() as connection:
            rows = (
                connection.execute(
                    text("SELECT run_id,result FROM run_checkpoints WHERE name=:name FOR UPDATE"),
                    {"name": NAME},
                )
                .mappings()
                .all()
            )
            for row in rows:
                prior = row["result"]
                if (
                    source_hash(prior) not in {PREVIOUS_SOURCE, ACCEPTED_SOURCE}
                    or {**prior, "source": target["source"]} != target
                ):
                    raise SystemExit("Unexpected prior manifest for " + row["run_id"])
                operation = (
                    connection.execute(
                        text(
                            f'SELECT function_id,output,serialization FROM "{schema}".operation_outputs WHERE workflow_uuid=:id AND function_name=:name FOR UPDATE'
                        ),
                        {"id": row["run_id"], "name": NAME},
                    )
                    .mappings()
                    .one()
                )
                if (
                    operation["function_id"] != 1
                    or operation["serialization"] not in {None, "py_pickle"}
                    or serializer.deserialize(operation["output"]) != prior
                ):
                    raise SystemExit("Unexpected DBOS manifest operation.")
                if prior == target:
                    unchanged.append(row["run_id"])
                    continue
                if args.apply:
                    result = connection.execute(
                        text(
                            "UPDATE run_checkpoints SET result=CAST(:target AS jsonb) WHERE run_id=:id AND name=:name AND result=CAST(:prior AS jsonb)"
                        ),
                        {
                            "id": row["run_id"],
                            "name": NAME,
                            "target": json.dumps(target),
                            "prior": json.dumps(prior),
                        },
                    )
                    if result.rowcount != 1:
                        raise RuntimeError("Application manifest changed during migration.")
                    result = connection.execute(
                        text(
                            f'UPDATE "{schema}".operation_outputs SET output=:target WHERE workflow_uuid=:id AND function_id=1 AND output=:prior'
                        ),
                        {
                            "id": row["run_id"],
                            "target": serializer.serialize(target),
                            "prior": operation["output"],
                        },
                    )
                    if result.rowcount != 1:
                        raise RuntimeError("DBOS manifest changed during migration.")
                migrated.append(row["run_id"])
        print(json.dumps({"applied": args.apply, "migrated": migrated, "unchanged": unchanged}))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
