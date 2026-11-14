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
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.engine import make_url

from formlane.models import Run, RunCheckpoint, RunEvent
from formlane.storage import (
    LEASE_DURATION_MS,
    LeaseLost,
    Store,
    StoreError,
    timestamp,
)


@contextmanager
def postgres_store(revision="head"):
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
            command.upgrade(config, revision)
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


@pytest.mark.parametrize("resumed", [False, True])
def test_queued_and_resumed_work_survives_long_wait(pg_store, project, owner, monkeypatch, resumed):
    clock = 1_000_000
    monkeypatch.setattr(
        "formlane.storage.timestamp", lambda now=None: clock if now is None else now
    )
    if resumed:
        previous = start(pg_store, project, owner)
        pg_store.cancel_run(project["id"], owner, previous["id"])
        receipt = pg_store.resume_run(project["id"], owner, previous["id"])
    else:
        receipt = pg_store.create_run(project["id"], owner, "Build")
    clock += 1_800_000
    assert pg_store.get_run(project["id"], owner, receipt["id"])["status"] == "queued"
    with pytest.raises(StoreError) as duplicate:
        pg_store.create_run(project["id"], owner, "Another instruction")
    assert duplicate.value.status == 409
    claimed = pg_store.claim_run("worker")
    assert claimed["id"] == receipt["id"]
    assert claimed["attempt_started_at"] == clock
    assert claimed["lease_expires_at"] == clock + LEASE_DURATION_MS
    assert claimed["started_at"] == (previous["started_at"] if resumed else clock)
    assert claimed["attempt"] == (2 if resumed else 1)


def test_failed_checkpoint_commit_leaves_no_partial_result(pg_store, project, owner, monkeypatch):
    clock = 1_000_000
    monkeypatch.setattr(
        "formlane.storage.timestamp", lambda now=None: clock if now is None else now
    )
    run = start(pg_store, project, owner)
    clock += 1_000

    def fail_commit(session):
        session.flush()
        assert session.get(RunCheckpoint, (run["id"], "uncommitted")) is not None
        raise RuntimeError("checkpoint commit unavailable")

    event.listen(pg_store.sessions, "before_commit", fail_commit)
    try:
        with pytest.raises(RuntimeError, match="checkpoint commit unavailable"):
            pg_store.put_checkpoint(run["id"], run["lease_token"], "uncommitted", {})
    finally:
        event.remove(pg_store.sessions, "before_commit", fail_commit)
    with pg_store.sessions() as session:
        assert session.get(RunCheckpoint, (run["id"], "uncommitted")) is None


@pytest.mark.parametrize("authority_loss", ["reclaimed", "cancelled"])
def test_fenced_checkpoint_cannot_change_committed_history(
    pg_store, project, owner, result, monkeypatch, authority_loss
):
    clock = 1_000_000
    monkeypatch.setattr(
        "formlane.storage.timestamp", lambda now=None: clock if now is None else now
    )
    run = start(pg_store, project, owner)
    clock += 1_000
    checkpoint = pg_store.put_checkpoint(
        run["id"], run["lease_token"], "committed", {"first": True}
    )
    clock += LEASE_DURATION_MS
    if authority_loss == "reclaimed":
        replacement = pg_store.claim_run("replacement")
        assert replacement["lease_token"] != run["lease_token"]
        assert replacement["attempt_started_at"] == run["attempt_started_at"]
    else:
        pg_store.cancel_run(project["id"], owner, run["id"])
    for name in ["committed", "late"]:
        with pytest.raises(LeaseLost):
            pg_store.put_checkpoint(run["id"], run["lease_token"], name, {"stale": True})
    assert not pg_store.heartbeat(run["id"], run["lease_token"])
    assert not pg_store.complete_run(run["id"], run["lease_token"], result)
    with pg_store.sessions() as session:
        assert session.get(RunCheckpoint, (run["id"], "committed")).result == checkpoint["value"]
        assert session.get(RunCheckpoint, (run["id"], "late")) is None


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


def test_expired_lease_fences_all_writes_and_cancellation_allows_retry(
    pg_store, project, owner, result
):
    run = start(pg_store, project, owner)
    with pg_store.sessions.begin() as session:
        session.get(Run, run["id"]).lease_expires_at = timestamp() - 1
    assert not pg_store.heartbeat(run["id"], run["lease_token"])
    assert not pg_store.complete_run(run["id"], run["lease_token"], result)
    with pytest.raises(LeaseLost):
        pg_store.put_checkpoint(run["id"], run["lease_token"], "late", {})
    pg_store.cancel_run(project["id"], owner, run["id"])
    assert pg_store.get_run(project["id"], owner, run["id"])["status"] == "cancelled"
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


def test_long_running_work_can_complete_while_heartbeats_keep_authority(
    pg_store, project, owner, result, monkeypatch
):
    clock = timestamp()
    created = pg_store.create_run(project["id"], owner, "Build the app", now=clock - 3_600_000)
    run = pg_store.claim_run("long-running-worker", now=clock)
    assert run["id"] == created["id"]
    for elapsed in range(30_000, 3_600_001, 30_000):
        assert pg_store.heartbeat(run["id"], run["lease_token"], clock + elapsed)
    monkeypatch.setattr(
        "formlane.storage.timestamp", lambda now=None: clock + 3_600_000 if now is None else now
    )
    assert pg_store.get_run(project["id"], owner, run["id"])["status"] == "running"
    assert pg_store.complete_run(run["id"], run["lease_token"], result)
    assert pg_store.get_project(project["id"], owner)["source"] == result["source"]


@pytest.mark.parametrize("terminal", ["failed", "cancelled"])
def test_resume_preserves_checkpoint_source_history_and_fences_old_attempt(
    pg_store, project, owner, result, terminal
):
    baseline = complete(pg_store, project, owner, result)
    run = start(pg_store, project, owner, "Keep the saved app and add a counter")
    checkpoint = pg_store.put_checkpoint(
        run["id"], run["lease_token"], "source:committed", {"source": result["source"]}
    )
    assert pg_store.finish_run(run["id"], run["lease_token"], terminal, "provider", "secret")
    before = pg_store.get_run(project["id"], owner, run["id"])
    detail = pg_store.get_project(project["id"], owner)
    history = pg_store.list_run_events(project["id"], owner, run["id"], 0)
    assert before["attempt"] == 1 and before["resumable"]
    clock = timestamp()
    resumed = pg_store.resume_run(project["id"], owner, run["id"], now=clock)
    assert resumed["id"] == before["id"]
    assert resumed["createdAt"] == before["createdAt"]
    assert resumed["startedAt"] == before["startedAt"]
    assert resumed["request"] == before["request"]
    assert resumed["status"] == "queued" and resumed["attempt"] == 2
    assert resumed["cursor"] == before["cursor"] + 1
    assert not resumed["resumable"]
    assert resumed["error"] is resumed["errorCode"] is resumed["finishedAt"] is None
    after = pg_store.get_project(project["id"], owner)
    assert after["messages"] == detail["messages"]
    assert after["source"] == detail["source"] == result["source"]
    assert after["project"]["currentVersionId"] == baseline["id"]
    assert not pg_store.heartbeat(run["id"], run["lease_token"])
    assert not pg_store.complete_run(run["id"], run["lease_token"], result)
    assert not pg_store.finish_run(run["id"], run["lease_token"], "failed", "provider", "late")
    for operation in [
        lambda: pg_store.check_authority(run["id"], run["lease_token"]),
        lambda: pg_store.put_checkpoint(run["id"], run["lease_token"], "late", {}),
        lambda: pg_store.append_event(run["id"], run["lease_token"], "late", "token", {}),
    ]:
        with pytest.raises(LeaseLost):
            operation()
    claimed = pg_store.claim_run("resumed-worker", now=clock)
    assert claimed["lease_token"] != run["lease_token"]
    assert claimed["previous_version_id"] == baseline["id"]
    assert claimed["attempt_started_at"] == clock

    assert claimed["execution_version"] == run["execution_version"] == "flow-v2"
    assert (
        pg_store.get_checkpoint(run["id"], claimed["lease_token"], "source:committed") == checkpoint
    )
    context = pg_store.harness_context(run["id"], claimed["lease_token"])
    assert context["attempt"] == 2 and context["previousSource"] == result["source"]
    assert pg_store.finish_run(run["id"], claimed["lease_token"], "failed", "validation", "secret")
    events = pg_store.list_run_events(project["id"], owner, run["id"], 0)
    assert events[: len(history)] == history
    assert [event["sequence"] for event in events] == list(range(1, len(events) + 1))
    assert [
        (event["attempt"], event["data"]["attempt"], event["data"]["status"])
        for event in events[-3:]
    ] == [(2, 2, "queued"), (2, 2, "running"), (2, 2, "failed")]


def test_concurrent_resume_grants_only_one_new_attempt_and_reclaim_preserves_it(
    pg_store, project, owner
):
    run = start(pg_store, project, owner)
    pg_store.cancel_run(project["id"], owner, run["id"])
    clock = timestamp()
    with ThreadPoolExecutor(max_workers=4) as pool:
        receipts = list(
            pool.map(
                lambda index: pg_store.resume_run(
                    project["id"], owner, run["id"], now=clock + index
                ),
                range(4),
            )
        )
    assert all(receipt == receipts[0] for receipt in receipts)
    assert receipts[0]["attempt"] == 2
    claimed = pg_store.claim_run("first-resumed-worker")
    pg_store.resume_run(project["id"], owner, run["id"], now=clock + 10_000)
    with pg_store.sessions.begin() as session:
        persisted = session.get(Run, run["id"])
        assert persisted.attempt == 2
        persisted.lease_expires_at = timestamp() - 1
    reclaimed = pg_store.claim_run("reclaimed-worker")
    assert reclaimed["attempt"] == 2
    assert reclaimed["attempt_started_at"] == claimed["attempt_started_at"]


def test_new_run_and_version_selection_permanently_revoke_resume(pg_store, project, owner, result):
    baseline = complete(pg_store, project, owner, result)
    failed = start(pg_store, project, owner)
    pg_store.cancel_run(project["id"], owner, failed["id"])
    newer = pg_store.create_run(project["id"], owner, "Different request", now=failed["created_at"])
    pg_store.cancel_run(project["id"], owner, newer["id"])
    assert pg_store.get_run(project["id"], owner)["id"] == newer["id"]
    assert not pg_store.get_run(project["id"], owner, failed["id"])["resumable"]
    with pytest.raises(StoreError) as superseded:
        pg_store.resume_run(project["id"], owner, failed["id"])
    assert superseded.value.status == 409
    # Even reselecting the same baseline is an explicit selection boundary.
    pg_store.restore_version(project["id"], owner, baseline["id"])
    assert not pg_store.get_run(project["id"], owner, newer["id"])["resumable"]
    with pytest.raises(StoreError) as selected:
        pg_store.resume_run(project["id"], owner, newer["id"])
    assert selected.value.status == 409
    with pytest.raises(StoreError) as completed:
        pg_store.resume_run(project["id"], owner, baseline["id"])
    assert completed.value.status == 409


def test_resume_rolls_back_attempt_and_fence_when_event_commit_fails(
    pg_store, project, owner, monkeypatch
):
    run = start(pg_store, project, owner)
    pg_store.cancel_run(project["id"], owner, run["id"])
    before = pg_store.get_run(project["id"], owner, run["id"])

    def fail_event(*_args):
        raise RuntimeError("event persistence unavailable")

    monkeypatch.setattr(pg_store, "_state", fail_event)
    with pytest.raises(RuntimeError, match="event persistence unavailable"):
        pg_store.resume_run(project["id"], owner, run["id"])
    assert pg_store.get_run(project["id"], owner, run["id"]) == before
    with pg_store.sessions() as session:
        persisted = session.get(Run, run["id"])
        assert persisted.lease_token == run["lease_token"]
        assert persisted.attempt_started_at == run["attempt_started_at"]


def test_resume_rejects_baseline_mismatch_even_when_recovery_marker_is_present(
    pg_store, project, owner, result
):
    baseline = complete(pg_store, project, owner, result)
    run = start(pg_store, project, owner)
    pg_store.cancel_run(project["id"], owner, run["id"])
    with pg_store.engine.begin() as connection:
        connection.execute(
            text("UPDATE projects SET current_version_id = NULL WHERE id = :id"),
            {"id": project["id"]},
        )
    with pytest.raises(StoreError) as changed:
        pg_store.resume_run(project["id"], owner, run["id"])
    assert changed.value.status == 409
    with pg_store.sessions() as session:
        assert session.get(Run, run["id"]).previous_version_id == baseline["id"]


@pytest.mark.parametrize("retired", ["flow-v1", "crew-v1", "dbos-v1"])
@pytest.mark.parametrize("terminal", ["failed", "cancelled"])
def test_retired_history_cannot_resume_or_change_attempt(
    pg_store, project, owner, retired, terminal
):
    run = start(pg_store, project, owner)
    assert pg_store.finish_run(run["id"], run["lease_token"], terminal, "provider", "safe")
    with pg_store.sessions.begin() as session:
        session.get(Run, run["id"]).execution_version = retired
    before = pg_store.get_run(project["id"], owner, run["id"])
    history = pg_store.list_run_events(project["id"], owner, run["id"], 0)
    assert not before["resumable"]
    with pytest.raises(StoreError) as incompatible:
        pg_store.resume_run(project["id"], owner, run["id"])
    assert incompatible.value.status == 409
    assert pg_store.get_run(project["id"], owner, run["id"]) == before
    assert pg_store.list_run_events(project["id"], owner, run["id"], 0) == history
    assert pg_store.claim_run("new-release") is None


@pytest.mark.parametrize("retired", ["flow-v1", "crew-v1", "dbos-v1"])
def test_retired_queued_history_is_never_claimed(pg_store, project, owner, retired):
    run = pg_store.create_run(project["id"], owner, "Keep the original runtime")
    with pg_store.sessions.begin() as session:
        session.get(Run, run["id"]).execution_version = retired
    history = pg_store.list_run_events(project["id"], owner, run["id"], 0)
    assert pg_store.claim_run("new-release") is None
    assert pg_store.get_run(project["id"], owner, run["id"]) == {**run, "selection": None}
    assert pg_store.list_run_events(project["id"], owner, run["id"], 0) == history


def test_incompatible_workflow_failure_cannot_be_resumed(pg_store, project, owner):
    run = start(pg_store, project, owner)
    assert not pg_store.fail_incompatible_run(run["id"], "stale-token")
    assert pg_store.fail_incompatible_run(run["id"], run["lease_token"])
    snapshot = pg_store.get_run(project["id"], owner, run["id"])
    assert snapshot["status"] == "failed" and snapshot["errorCode"] == "internal"
    assert not snapshot["resumable"]
    assert (
        snapshot["error"]
        == "This run requires its original execution version and cannot resume on this deployment."
    )
    with pytest.raises(StoreError) as incompatible:
        pg_store.resume_run(project["id"], owner, run["id"])
    assert incompatible.value.status == 409
    assert (
        pg_store.list_run_events(project["id"], owner, run["id"], 0)[-1]["data"]["resumable"]
        is False
    )


def test_recovery_migration_preserves_legacy_run_and_event_history(owner):
    with postgres_store("0001_postgres") as store:
        project_id, old_run, latest_run = str(uuid4()), str(uuid4()), str(uuid4())
        clock = timestamp()
        with store.engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO projects (id,owner_id,title,idea,status,created_at,updated_at) VALUES (:id,:owner,'Legacy','Legacy','error',:clock,:clock)"
                ),
                {"id": project_id, "owner": owner, "clock": clock},
            )
            for offset, run_id in enumerate([old_run, latest_run]):
                connection.execute(
                    text(
                        "INSERT INTO runs (id,project_id,status,request,created_at,deadline_at,event_cursor) VALUES (:id,:project,'failed','Keep my source',:clock,:deadline,1)"
                    ),
                    {
                        "id": run_id,
                        "project": project_id,
                        "clock": clock + offset,
                        "deadline": clock + 900_000,
                    },
                )
                connection.execute(
                    text(
                        "INSERT INTO run_events (run_id,sequence,event_key,type,data,created_at) VALUES (:id,1,'state:failed','run_state',CAST(:data AS jsonb),:clock)"
                    ),
                    {"id": run_id, "data": '{"status":"failed"}', "clock": clock},
                )
            connection.execute(
                text(
                    "INSERT INTO run_checkpoints (run_id,name,result,created_at) VALUES (:id,'legacy:source',CAST(:result AS jsonb),:clock)"
                ),
                {"id": latest_run, "result": '{"source":"retained"}', "clock": clock},
            )
        with store.engine.begin() as connection:
            config = Config(str(Path(__file__).parents[1] / "alembic.ini"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        assert not store.get_run(project_id, owner, old_run)["resumable"]
        migrated = store.get_run(project_id, owner, latest_run)
        # History migrates intact; earlier execution versions cannot replay on this worker.
        assert migrated["attempt"] == 1 and not migrated["resumable"]
        event = store.list_run_events(project_id, owner, latest_run, 0)[0]
        assert event["attempt"] == 1 and event["data"] == {"status": "failed"}
        with store.engine.connect() as connection:
            assert connection.execute(
                text("SELECT result FROM run_checkpoints WHERE run_id=:id"), {"id": latest_run}
            ).scalar() == {"source": "retained"}
