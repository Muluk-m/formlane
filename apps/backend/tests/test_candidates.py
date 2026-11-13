"""Retained candidates are owned draft artifacts, never accepted versions."""

from uuid import uuid4

import pytest
from test_storage import complete, start

from formlane.project import artifact_hash, source_hash
from formlane.storage import Store, StoreError


def save_candidate(store, job, result, index=0, compiled=True):
    value = {
        "source": result["source"],
        "sourceHash": source_hash(result["source"]),
        "html": result["html"] if compiled else None,
        "artifactHash": artifact_hash(result["html"]) if compiled else None,
        "internal": "not part of the public candidate",
    }
    store.put_checkpoint(job["id"], job["lease_token"], f"flow-v2/candidate/{index:06d}", value)


@pytest.mark.parametrize("compiled", [False, True])
def test_failed_candidate_survives_reconnect_without_becoming_a_version(
    pg_store, project, owner, result, compiled
):
    job = start(pg_store, project, owner)
    save_candidate(pg_store, job, result, compiled=compiled)
    assert pg_store.finish_run(job["id"], job["lease_token"], "failed", "validation", "safe")
    reopened = Store(pg_store.engine.url.render_as_string(hide_password=False))
    try:
        detail = reopened.get_project(project["id"], owner)
        candidate = detail["candidate"]
        assert candidate["runId"] == job["id"]
        assert candidate["source"] == result["source"]
        assert candidate["html"] == (result["html"] if compiled else None)
        assert "internal" not in candidate
        assert detail["versions"] == []
        assert detail["source"] is None and detail["html"] is None
        with pytest.raises(StoreError) as denied:
            reopened.get_project(project["id"], str(uuid4()))
        assert denied.value.status == 404
        with pytest.raises(StoreError):
            reopened.publish_project(project["id"], owner)
        with pytest.raises(StoreError):
            reopened.get_version(project["id"], owner)
    finally:
        reopened.close()


def test_unaccepted_candidate_never_replaces_current_or_published_version(
    pg_store, project, owner, result
):
    complete(pg_store, project, owner, result)
    published = pg_store.publish_project(project["id"], owner)
    draft = {**result, "html": "<!doctype html><html><body>Unaccepted</body></html>"}
    job = start(pg_store, project, owner, "Change the heading")
    save_candidate(pg_store, job, draft)
    pg_store.cancel_run(project["id"], owner, job["id"])
    detail = pg_store.get_project(project["id"], owner)
    assert detail["candidate"]["html"] == draft["html"]
    assert detail["html"] == result["html"]
    assert detail["project"]["currentVersionId"] == published["versionId"]
    assert pg_store.get_published(published["slug"])["html"] == result["html"]
    resumed = pg_store.resume_run(project["id"], owner, job["id"])
    assert resumed["id"] == job["id"]
    assert pg_store.get_project(project["id"], owner)["candidate"]["runId"] == job["id"]
    replacement = pg_store.claim_run("resumed")
    assert pg_store.complete_run(job["id"], replacement["lease_token"], draft)
    accepted = pg_store.get_project(project["id"], owner)
    assert accepted["candidate"] is None
    assert accepted["html"] == draft["html"]
    assert pg_store.get_published(published["slug"])["html"] == result["html"]


def test_new_request_hides_obsolete_candidate_and_keeps_saved_checkpoints(
    pg_store, project, owner, result
):
    old = start(pg_store, project, owner)
    save_candidate(pg_store, old, result)
    pg_store.cancel_run(project["id"], owner, old["id"])
    replacement = start(pg_store, project, owner, "Different request")
    assert pg_store.get_project(project["id"], owner)["candidate"] is None
    save_candidate(pg_store, replacement, result, index=1, compiled=False)
    compiled = {**result, "html": "<!doctype html><html><body>Newest candidate</body></html>"}
    save_candidate(pg_store, replacement, compiled, index=2)
    detail = pg_store.get_project(project["id"], owner)
    assert detail["candidate"]["runId"] == replacement["id"]
    assert detail["candidate"]["html"] == compiled["html"]
    assert detail["candidate"]["artifactHash"] == artifact_hash(compiled["html"])


def test_capability_failure_preserves_draft_and_requires_revised_request(
    pg_store, project, owner, result
):
    job = start(pg_store, project, owner, "Share persistent loan records")
    save_candidate(pg_store, job, result)
    assert pg_store.finish_run(job["id"], job["lease_token"], "failed", "capability", "safe")
    run = pg_store.get_run(project["id"], owner, job["id"])
    assert run["errorCode"] == "capability" and not run["resumable"]
    assert pg_store.get_project(project["id"], owner)["candidate"]["runId"] == job["id"]
    with pytest.raises(StoreError) as blocked:
        pg_store.resume_run(project["id"], owner, job["id"])
    assert blocked.value.status == 409
    revised = pg_store.create_run(
        project["id"], owner, "Build an explicitly session-only prototype"
    )
    assert revised["id"] != job["id"]
