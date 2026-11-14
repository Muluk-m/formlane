"""Migration compatibility and atomic expected-version admission on PostgreSQL."""

import json
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from test_storage import complete, postgres_store

from formlane.app import create_app
from formlane.project import legacy_source
from formlane.settings import Settings
from formlane.storage import StoreError, timestamp


def test_selection_migration_preserves_populated_history_and_readiness(owner):
    with postgres_store("0004_version_acceptance_checks") as store:
        project_id, version_id, run_id, message_id = (str(uuid4()) for _ in range(4))
        clock = timestamp()
        source = legacy_source("<h1>Historical accepted source</h1>")
        with store.engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO projects (id,owner_id,title,idea,status,created_at,updated_at) "
                    "VALUES (:id,:owner,'Historical','Keep history','idle',:clock,:clock)"
                ),
                {"id": project_id, "owner": owner, "clock": clock},
            )
            connection.execute(
                text(
                    "INSERT INTO versions (id,project_id,number,html,prompt,created_at,source) "
                    "VALUES (:id,:project,1,'<h1>Historical accepted source</h1>','Original',:clock,CAST(:source AS jsonb))"
                ),
                {
                    "id": version_id,
                    "project": project_id,
                    "clock": clock,
                    "source": json.dumps(source),
                },
            )
            connection.execute(
                text(
                    "UPDATE projects SET current_version_id=:version,published_version_id=:version,published_slug='historical' WHERE id=:id"
                ),
                {"version": version_id, "id": project_id},
            )
            connection.execute(
                text(
                    "INSERT INTO runs (id,project_id,status,request,previous_version_id,created_at,attempt_started_at,execution_version,recovery_eligible) "
                    "VALUES (:id,:project,'cancelled','Keep my comment',:version,:clock,:clock,'flow-v2',true)"
                ),
                {"id": run_id, "project": project_id, "version": version_id, "clock": clock},
            )
            connection.execute(
                text(
                    "INSERT INTO messages (id,project_id,role,content,created_at) "
                    "VALUES (:id,:project,'user','Keep my comment',:clock)"
                ),
                {"id": message_id, "project": project_id, "clock": clock},
            )
        settings = Settings(database_url="postgresql://unused/unused")
        with TestClient(create_app(settings, store)) as client:
            assert client.get("/healthz").status_code == 503
        config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
        with store.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        with TestClient(create_app(settings, store)) as client:
            assert client.get("/healthz").status_code == 200
        detail = store.get_project(project_id, owner)
        assert detail["source"] == source
        assert (
            detail["project"]["currentVersionId"]
            == detail["project"]["publishedVersionId"]
            == version_id
        )
        assert detail["messages"][0]["content"] == "Keep my comment"
        assert detail["messages"][0]["selectionSummary"] is None
        run = store.get_run(project_id, owner, run_id)
        assert run["selection"] is None and run["selectionSummary"] is None
        with pytest.raises(StoreError) as retired:
            store.resume_run(project_id, owner, run_id)
        assert retired.value.status == 409
        assert store.claim_run("migrated-worker") is None


def test_expected_current_version_conflict_keeps_existing_state(pg_store, project, owner, result):
    first = complete(pg_store, project, owner, result)
    second = complete(pg_store, project, owner, result, "Accepted second version")
    before = pg_store.get_project(project["id"], owner)
    with pytest.raises(StoreError) as conflict:
        pg_store.create_run(project["id"], owner, "Do not rebase", expected_version_id=first["id"])
    assert conflict.value.status == 409
    assert pg_store.get_project(project["id"], owner) == before
    run = pg_store.create_run(
        project["id"], owner, "Correct baseline", expected_version_id=second["id"]
    )
    assert pg_store.get_run(project["id"], owner, run["id"])["selection"] is None
