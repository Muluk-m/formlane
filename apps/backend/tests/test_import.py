import json
import sqlite3
from copy import deepcopy

import pytest
from sqlalchemy import Integer, select
from sqlalchemy.exc import IntegrityError
from test_storage import complete, postgres_store, start

from formlane.import_d1 import (
    EXTRA_COLUMNS,
    JSON_COLUMNS,
    TABLES,
    ImportConflict,
    import_data,
    manifest,
    read_export,
    read_target,
)
from formlane.models import Run


@pytest.fixture
def exported(pg_store, project, owner, result):
    first = start(pg_store, project, owner)
    pg_store.put_checkpoint(first["id"], first["lease_token"], "null", None)
    pg_store.put_checkpoint(first["id"], first["lease_token"], "string-null", "null")
    pg_store.put_checkpoint(first["id"], first["lease_token"], "string-object", '{"literal":true}')
    pg_store.put_checkpoint(
        first["id"],
        first["lease_token"],
        "draft",
        {"source": result["source"], "notes": ["旧版; quoted 'text'"]},
    )
    assert pg_store.complete_run(first["id"], first["lease_token"], result)
    complete(
        pg_store,
        project,
        owner,
        {**result, "html": "<!doctype html>\r\n<html>第二版; 'quoted'</html>"},
        "Second",
    )
    pg_store.publish_project(project["id"], owner)
    pg_store.restore_version(project["id"], owner, first["id"])
    complete(pg_store, project, owner, result, "Branch from root")
    with pg_store.engine.connect() as connection:
        data = read_target(connection)
    # D1 has globally allocated sequences with gaps; importer must never renumber them.
    for index, event in enumerate(data["run_events"], 1):
        event["sequence"] = index * 11
    data["messages"][1]["created_at"] = data["messages"][0]["created_at"]
    return data


def test_legacy_failed_run_import_preserves_recovery(pg_store, project, owner, result):
    failed = start(pg_store, project, owner)
    pg_store.put_checkpoint(failed["id"], failed["lease_token"], "saved-source", result["source"])
    assert pg_store.finish_run(failed["id"], failed["lease_token"], "failed", "provider", "Failed")
    with pg_store.engine.connect() as connection:
        exported = read_target(connection)
    with postgres_store() as target:
        import_data(target, exported)
        resumed = target.resume_run(project["id"], owner, failed["id"])
        assert resumed["id"] == failed["id"]
        assert resumed["attempt"] == 2
        claim = target.claim_run("import-recovery")
        assert claim["execution_version"] == "crew-v1"
        checkpoint = target.get_checkpoint(claim["id"], claim["lease_token"], "saved-source")
        assert checkpoint["value"] == result["source"]


def raw_d1_json(data):
    raw = deepcopy(data)
    for name, columns in JSON_COLUMNS.items():
        for row in raw[name]:
            for column in columns:
                row[column] = json.dumps(row[column], ensure_ascii=False)
    return raw


def sqlite_dump(data):
    """Build an actual offline SQLite dump solely as D1 import input."""
    connection = sqlite3.connect(":memory:")
    try:
        for name, rows in raw_d1_json(data).items():
            columns = (
                list(rows[0])
                if rows
                else [
                    column.name
                    for column in TABLES[name].columns
                    if column.name not in EXTRA_COLUMNS.get(name, set())
                ]
            )
            definitions = [
                f'"{column}" {"INTEGER" if isinstance(TABLES[name].c[column].type, Integer) else "TEXT"}'
                for column in columns
            ]
            connection.execute(f'CREATE TABLE "{name}" ({", ".join(definitions)})')
            for row in rows:
                connection.execute(
                    f'INSERT INTO "{name}" VALUES ({", ".join("?" for _ in columns)})',
                    [row[column] for column in columns],
                )
        connection.commit()
        return "\n".join(connection.iterdump())
    finally:
        connection.close()


@pytest.mark.parametrize("format", ["sql", "json"])
def test_faithful_six_table_import_counts_hashes_ancestry_and_checkpoint_strings(
    exported, tmp_path, format
):
    snapshot = tmp_path / f"snapshot.{format}"
    snapshot.write_text(
        sqlite_dump(exported) if format == "sql" else json.dumps(raw_d1_json(exported)),
        encoding="utf-8",
    )
    data = read_export(snapshot)
    assert data == exported
    with postgres_store() as target:
        report = import_data(target, data)
        assert report["verified"] and report["inserted"]
        with target.engine.connect() as connection:
            actual = read_target(connection)
            runs = connection.execute(select(Run.id, Run.event_cursor)).all()
        assert manifest(actual) == manifest(exported)
        for run_id, cursor in runs:
            assert cursor == max(
                row["sequence"] for row in data["run_events"] if row["run_id"] == run_id
            )
        repeated = import_data(target, data)
        assert repeated["verified"] and not repeated["inserted"]
        assert import_data(target, data, verify_only=True)["verified"]
        project = data["projects"][0]
        detail = target.get_project(project["id"], project["owner_id"])
        assert detail["project"]["currentVersionId"] == project["current_version_id"]
        assert detail["project"]["publishedVersionId"] == project["published_version_id"]
        assert detail["versions"][-1]["parentVersionId"] == detail["versions"][0]["id"]
        public_version = next(
            row for row in data["versions"] if row["id"] == project["published_version_id"]
        )
        assert target.get_published(project["published_slug"])["html"] == public_version["html"]
        checkpoints = {row["name"]: row["result"] for row in actual["run_checkpoints"]}
        assert checkpoints["null"] is None and checkpoints["string-null"] == "null"
        assert checkpoints["string-object"] == '{"literal":true}'
        # New per-run cursor allocation starts above imported histories.
        new = target.create_run(project["id"], project["owner_id"], "Follow up")
        assert new["cursor"] == 1
        assert (
            target.claim_run("post-import")["previous_version_id"] == project["current_version_id"]
        )


def test_conflicting_repeat_is_rejected_without_mutating_target(exported):
    with postgres_store() as target:
        import_data(target, exported)
        conflicting = deepcopy(exported)
        conflicting["projects"][0]["title"] = "Changed during rehearsal"
        with pytest.raises(ImportConflict, match="never merged"):
            import_data(target, conflicting)
        with target.engine.connect() as connection:
            assert manifest(read_target(connection)) == manifest(exported)


def test_import_rolls_back_all_tables_on_database_constraint_failure(exported):
    invalid = deepcopy(exported)
    invalid["versions"][1]["number"] = invalid["versions"][0]["number"]
    with postgres_store() as target:
        with pytest.raises(IntegrityError):
            import_data(target, invalid)
        with target.engine.connect() as connection:
            assert not any(read_target(connection).values())
        assert import_data(target, exported)["verified"]


def test_import_rejects_running_snapshot_missing_tables_and_foreign_parent(exported):
    with postgres_store() as target:
        for broken in ("active", "missing", "parent"):
            data = deepcopy(exported)
            if broken == "active":
                data["runs"][0]["status"] = "running"
            elif broken == "missing":
                del data["run_checkpoints"]
            else:
                data["versions"][0]["parent_version_id"] = "missing-version"
            with pytest.raises(ValueError):
                import_data(target, data)
        with target.engine.connect() as connection:
            assert not any(read_target(connection).values())


def test_verify_only_never_inserts(exported):
    with postgres_store() as target:
        with pytest.raises(ImportConflict):
            import_data(target, exported, verify_only=True)
        with target.engine.connect() as connection:
            assert not any(read_target(connection).values())


def test_sql_dump_cannot_attach_files(tmp_path):
    snapshot = tmp_path / "attach.sql"
    snapshot.write_text("ATTACH DATABASE '/tmp/forbidden.sqlite' AS external;", encoding="utf-8")
    with pytest.raises(sqlite3.DatabaseError):
        read_export(snapshot)


@pytest.mark.parametrize("format", ["sql", "json"])
def test_pre_0006_ancestry_uses_recorded_origin_only(exported, tmp_path, format):
    from uuid import uuid4

    legacy = deepcopy(exported)
    copied = {**legacy["versions"][-1], "id": str(uuid4()), "number": 4}
    legacy["versions"].append(copied)
    for row in legacy["versions"]:
        del row["parent_version_id"]
    snapshot = tmp_path / f"legacy.{format}"
    snapshot.write_text(
        sqlite_dump(legacy) if format == "sql" else json.dumps(raw_d1_json(legacy)),
        encoding="utf-8",
    )
    normalized = read_export(snapshot)
    by_number = {row["number"]: row for row in normalized["versions"]}
    assert by_number[1]["parent_version_id"] is None
    assert by_number[2]["parent_version_id"] == by_number[1]["id"]
    assert by_number[3]["parent_version_id"] == by_number[1]["id"]
    assert by_number[4]["parent_version_id"] is None
    for before, after in zip(legacy["versions"], normalized["versions"], strict=True):
        assert before["html"] == after["html"] and before["source"] == after["source"]
    with postgres_store() as target:
        report = import_data(target, normalized)
        assert "D1 0006" in report["ancestryPolicy"]
        assert report["verified"]


def test_explicit_unknown_ancestry_is_not_inferred_again(exported):
    explicit = deepcopy(exported)
    explicit["versions"][-1]["parent_version_id"] = None
    with postgres_store() as target:
        import_data(target, explicit)
        with target.engine.connect() as connection:
            actual = read_target(connection)
        selected = next(
            row for row in actual["versions"] if row["id"] == explicit["versions"][-1]["id"]
        )
        assert selected["parent_version_id"] is None
