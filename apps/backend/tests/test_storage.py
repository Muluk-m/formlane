"""Run with TEST_DATABASE_URL pointing at the dedicated PostgreSQL test database."""

import os
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from threading import Event
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import make_url

from formlane.models import Run, RunCheckpoint, RunEvent
from formlane.storage import LEASE_DURATION_MS, LeaseLost, Store, StoreError, timestamp


@contextmanager
def postgres_store():
    database_url = os.environ.get("TEST_DATABASE_URL")
    if not database_url:
        pytest.fail(
            "TEST_DATABASE_URL is required: these tests exercise real PostgreSQL locks and transactions."
        )
    url = make_url(database_url)
    if url.get_backend_name() != "postgresql":
        pytest.fail("TEST_DATABASE_URL must point to PostgreSQL, never SQLite.")
    url = url.set(drivername="postgresql+psycopg")
    schema = "test_formlane_" + uuid4().hex
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    store = Store(
        url.update_query_dict({"options": f"-csearch_path={schema}"}).render_as_string(
            hide_password=False
        )
    )
    try:
        config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
        with store.engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        yield store
    finally:
        store.close()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def start(store, project, owner, content="Build the app"):
    receipt = store.create_run(project["id"], owner, content)
    job = store.claim_run(str(uuid4()))
    assert job and job["id"] == receipt["id"]
    return job


def complete(store, project, owner, result, content="Build the app"):
    job = start(store, project, owner, content)
    assert store.complete_run(job["id"], job["lease_token"], result)
    return job


def test_concurrent_creation_claim_replay_and_single_global_lease(pg_store, project, owner, result):
    def create(_):
        try:
            return pg_store.create_run(project["id"], owner, "Build")
        except StoreError as error:
            assert error.status == 409
            return None

    with ThreadPoolExecutor(max_workers=4) as pool:
        created = list(pool.map(create, range(4)))
    assert len([row for row in created if row]) == 1
    other = pg_store.create_project(owner, "Another app")
    next_run = pg_store.create_run(other["id"], owner)
    with ThreadPoolExecutor(max_workers=4) as pool:
        claimed = list(pool.map(pg_store.claim_run, ["a", "b", "c", "d"]))
    winners = [row for row in claimed if row]
    assert len(winners) == 1
    winner = winners[0]
    assert pg_store.claim_run(winner["lease_owner"])["lease_token"] == winner["lease_token"]
    assert pg_store.claim_run("other") is None
    assert pg_store.complete_run(winner["id"], winner["lease_token"], result)
    assert pg_store.claim_run("other")["id"] == next_run["id"]


def test_reclaimed_lease_checkpoint_null_and_late_producer_fences(pg_store, project, owner, result):
    job = start(pg_store, project, owner)
    token, run_id = job["lease_token"], job["id"]
    assert pg_store.get_checkpoint(run_id, token, "missing") is None
    first = pg_store.put_checkpoint(run_id, token, "nullable", None)
    assert first["value"] is None
    assert pg_store.put_checkpoint(run_id, token, "nullable", {"overwrite": True}) == first
    with pg_store.sessions.begin() as session:
        session.get(Run, run_id).lease_expires_at = timestamp() - 1
    assert not pg_store.heartbeat(run_id, token)
    replacement = pg_store.claim_run("replacement")
    assert replacement["id"] == run_id and replacement["lease_token"] != token
    assert replacement["started_at"] == job["started_at"]
    assert pg_store.get_checkpoint(run_id, replacement["lease_token"], "nullable") == first
    for operation in [
        lambda: pg_store.append_event(run_id, token, "late", "token", {"text": "stale"}),
        lambda: pg_store.put_checkpoint(run_id, token, "late", {}),
        lambda: pg_store.get_checkpoint(run_id, token, "nullable"),
        lambda: pg_store.harness_context(run_id, token),
    ]:
        with pytest.raises(LeaseLost):
            operation()
    assert not pg_store.complete_run(run_id, token, result)
    assert not pg_store.finish_run(run_id, token, "failed", "provider", "private secret")
    assert pg_store.complete_run(run_id, replacement["lease_token"], result)


def test_event_order_waits_for_commit_and_rollback_reuses_cursor(pg_store, project, owner):
    job = start(pg_store, project, owner)
    run_id, token = job["id"], job["lease_token"]
    baseline = pg_store.get_run(project["id"], owner, run_id)["cursor"]
    started = Event()
    with ThreadPoolExecutor(max_workers=1) as pool:
        with pg_store.sessions.begin() as session:
            _, run = pg_store._require_lease(session, run_id, token)
            first = pg_store._event(session, run, "first", "token", {"text": "first"}, timestamp())

            def append_second():
                started.set()
                return pg_store.append_event(run_id, token, "second", "token", {"text": "second"})

            future = pool.submit(append_second)
            assert started.wait(5)
            # An independent PG reader sees neither uncommitted allocation nor later event.
            with pg_store.sessions() as observer:
                assert (
                    observer.scalar(
                        select(func.max(RunEvent.sequence)).where(RunEvent.run_id == run_id)
                    )
                    == baseline
                )
            assert not future.done()
            first_sequence = first.sequence
        second = future.result(timeout=10)
    assert first_sequence == baseline + 1 and second["sequence"] == baseline + 2
    after = second["sequence"]
    with pytest.raises(RuntimeError, match="rollback"):
        with pg_store.sessions.begin() as session:
            _, run = pg_store._require_lease(session, run_id, token)
            pg_store._event(session, run, "rolled-back", "token", {}, timestamp())
            raise RuntimeError("rollback")
    final = pg_store.append_event(run_id, token, "final", "token", {})
    assert final["sequence"] == after + 1
    replay = pg_store.list_run_events(project["id"], owner, run_id, baseline)
    assert [row["sequence"] for row in replay] == [baseline + 1, baseline + 2, baseline + 3]


def test_event_identity_and_message_persistence_use_first_payload(pg_store, project, owner):
    job = start(pg_store, project, owner)
    message = {"id": str(uuid4()), "role": "agent", "agent": "alex", "content": "Original"}
    event = pg_store.append_event(
        job["id"], job["lease_token"], "delegate:0", "message_done", message
    )
    replay = pg_store.append_event(
        job["id"],
        job["lease_token"],
        "delegate:0",
        "message_done",
        {**message, "content": "Changed"},
    )
    assert replay == event
    saved = pg_store.get_project(project["id"], owner)["messages"]
    assert [row["content"] for row in saved if row["id"] == message["id"]] == ["Original"]
    with pytest.raises(ValueError):
        pg_store.append_event(job["id"], job["lease_token"], "state:completed", "run_state", {})


def test_restore_ancestry_publication_remix_and_delete(pg_store, project, owner, result):
    root = complete(pg_store, project, owner, result)
    second_result = {**result, "html": "<html>Second version</html>"}
    second = complete(pg_store, project, owner, second_result, "Second")
    published = pg_store.publish_project(project["id"], owner)
    running = start(pg_store, project, owner, "Interrupted")
    restored = pg_store.restore_version(project["id"], owner, root["id"])
    assert restored["source"] == result["source"] and restored["number"] == 1
    assert not pg_store.complete_run(running["id"], running["lease_token"], result)
    assert not pg_store.heartbeat(running["id"], running["lease_token"])
    branch = complete(pg_store, project, owner, result, "Branch from root")
    saved = pg_store.get_project(project["id"], owner)
    assert saved["versions"][-1]["parentVersionId"] == root["id"]
    assert saved["project"]["publishedVersionId"] == second["id"]
    assert pg_store.get_published(published["slug"])["html"] == second_result["html"]
    remix = pg_store.remix_project(project["id"], owner, branch["id"])
    copied = pg_store.get_project(remix["id"], owner)
    assert copied["versions"][-1]["parentVersionId"] == copied["versions"][0]["id"]
    assert copied["versions"][1]["parentVersionId"] == copied["versions"][0]["id"]
    assert not (
        {row["id"] for row in saved["versions"]} & {row["id"] for row in copied["versions"]}
    )
    assert remix["publishedSlug"] is None and remix["publishedVersionId"] is None
    with pytest.raises(StoreError):
        pg_store.remix_project(remix["id"], owner, root["id"])
    with pytest.raises(StoreError):
        pg_store.get_project(project["id"], str(uuid4()))
    pg_store.unpublish_project(project["id"], owner)
    assert pg_store.get_published(published["slug"]) is None
    pg_store.delete_project(project["id"], owner)
    with pg_store.sessions() as session:
        assert session.get(Run, root["id"]) is None
        assert session.scalar(select(func.count()).select_from(RunEvent)) == 0
        assert session.scalar(select(func.count()).select_from(RunCheckpoint)) == 0
    assert pg_store.get_project(remix["id"], owner)["source"] == result["source"]


def test_completion_rolls_back_every_write_on_pointer_failure(pg_store, project, owner, result):
    job = start(pg_store, project, owner)
    with pg_store.engine.begin() as connection:
        connection.execute(
            text("""CREATE FUNCTION reject_current() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'test pointer rejection'; END; $$""")
        )
        connection.execute(
            text(
                "CREATE TRIGGER reject_current BEFORE UPDATE OF current_version_id ON projects FOR EACH ROW EXECUTE FUNCTION reject_current()"
            )
        )
    with pytest.raises(Exception, match="test pointer rejection"):
        pg_store.complete_run(job["id"], job["lease_token"], result)
    saved = pg_store.get_project(project["id"], owner)
    assert saved["versions"] == [] and saved["project"]["currentVersionId"] is None
    assert pg_store.get_run(project["id"], owner, job["id"])["status"] == "running"
    assert [
        event["type"] for event in pg_store.list_run_events(project["id"], owner, job["id"], 0)
    ] == ["run_state", "run_state"]
    assert not any(row["content"] == result["summary"] for row in saved["messages"])


@pytest.mark.parametrize("code", ["provider", "validation", "step_limit", "internal"])
def test_safe_failures_retain_current_and_published(pg_store, project, owner, result, code):
    first = complete(pg_store, project, owner, result)
    published = pg_store.publish_project(project["id"], owner)
    run = start(pg_store, project, owner, "Follow up")
    assert pg_store.finish_run(
        run["id"], run["lease_token"], "failed", code, "private upstream secret"
    )
    assert not pg_store.complete_run(run["id"], run["lease_token"], result)
    saved = pg_store.get_project(project["id"], owner)
    assert (
        saved["project"]["currentVersionId"]
        == saved["project"]["publishedVersionId"]
        == first["id"]
    )
    assert "private upstream secret" not in str(saved)
    snapshot = pg_store.get_run(project["id"], owner, run["id"])
    assert snapshot["status"] == "failed" and snapshot["errorCode"] == code
    assert "private upstream secret" not in str(
        pg_store.list_run_events(project["id"], owner, run["id"], 0)
    )
    assert pg_store.get_published(published["slug"])["html"] == result["html"]


def test_deadline_fences_all_writes_before_expiry_and_cancellation_allows_retry(
    pg_store, project, owner, result
):
    run = start(pg_store, project, owner)
    with pg_store.sessions.begin() as session:
        session.get(Run, run["id"]).deadline_at = timestamp() - 1
    assert not pg_store.heartbeat(run["id"], run["lease_token"])
    assert not pg_store.complete_run(run["id"], run["lease_token"], result)
    with pytest.raises(LeaseLost):
        pg_store.put_checkpoint(run["id"], run["lease_token"], "late", {})
    pg_store.expire_runs()
    assert pg_store.get_run(project["id"], owner, run["id"])["errorCode"] == "timeout"
    retry = start(pg_store, project, owner, "Retry")
    pg_store.cancel_run(project["id"], owner, retry["id"])
    assert not pg_store.complete_run(retry["id"], retry["lease_token"], result)
    assert not pg_store.heartbeat(retry["id"], retry["lease_token"])
    assert (
        pg_store.create_run(project["id"], owner, "New instruction", "initial")["status"]
        == "queued"
    )


def test_invalid_sources_never_replace_success_and_completion_replay_is_idempotent(
    pg_store, project, owner, result
):
    first = complete(pg_store, project, owner, result)
    assert pg_store.complete_run(
        first["id"], first["lease_token"], {**result, "html": "ignored retry"}
    )
    run = start(pg_store, project, owner, "Unsafe followup")
    unsafe = {
        **result["source"],
        "files": {**result["source"]["files"], "../outside.txt": "escape"},
    }
    with pytest.raises(ValueError):
        pg_store.complete_run(run["id"], run["lease_token"], {**result, "source": unsafe})
    saved = pg_store.get_project(project["id"], owner)
    assert len(saved["versions"]) == 1 and saved["html"] == result["html"]
    assert saved["project"]["currentVersionId"] == first["id"]


def test_heartbeat_caps_lease_at_deadline(pg_store, project, owner):
    run = start(pg_store, project, owner)
    clock = timestamp()
    with pg_store.sessions.begin() as session:
        session.get(Run, run["id"]).deadline_at = clock + 100
    assert pg_store.heartbeat(run["id"], run["lease_token"], clock)
    with pg_store.sessions() as session:
        saved = session.get(Run, run["id"])
        assert saved.lease_expires_at == clock + 100 < clock + LEASE_DURATION_MS
