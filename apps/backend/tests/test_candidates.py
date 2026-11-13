"""Retained candidates are owned draft artifacts, never accepted versions."""

import copy
from functools import wraps
from uuid import uuid4

import pytest
from test_agents import Checkpoints, runtime
from test_storage import complete, start

from formlane.delivery.tools import BuildProject, DeleteFile, EditFile, WriteFile
from formlane.models import Project, Run, RunCheckpoint
from formlane.project import artifact_hash, source_hash
from formlane.storage import EXECUTION_VERSION, Store, StoreError


def save_candidate(store, job, result, index=0, compiled=True):
    value = {
        "source": result["source"],
        "sourceHash": source_hash(result["source"]),
        "html": result["html"] if compiled else None,
        "artifactHash": artifact_hash(result["html"]) if compiled else None,
        "internal": "not part of the public candidate",
    }
    return store.put_checkpoint(
        job["id"], job["lease_token"], f"flow-v1/candidate/{index:06d}", value
    )


@pytest.mark.parametrize("compiled", [False, True])
def test_failed_candidate_survives_reconnect_without_becoming_a_version(
    pg_store, project, owner, result, compiled
):
    job = start(pg_store, project, owner)
    saved = save_candidate(pg_store, job, result, compiled=compiled)
    assert pg_store.finish_run(job["id"], job["lease_token"], "failed", "validation", "safe")
    reopened = Store(pg_store.engine.url.render_as_string(hide_password=False))
    try:
        detail = reopened.get_project(project["id"], owner)
        assert detail["candidate"] == {
            "runId": job["id"],
            "source": result["source"],
            "sourceHash": source_hash(result["source"]),
            "html": result["html"] if compiled else None,
            "artifactHash": artifact_hash(result["html"]) if compiled else None,
            "createdAt": saved["createdAt"],
        }
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
    draft = copy.deepcopy(result)
    draft["source"]["files"]["draft.js"] = "const draft = true"
    draft["html"] = "<!doctype html><html><body>Unaccepted</body></html>"
    job = start(pg_store, project, owner, "Change the heading")
    save_candidate(pg_store, job, draft)
    pg_store.cancel_run(project["id"], owner, job["id"])
    detail = pg_store.get_project(project["id"], owner)
    assert detail["candidate"]["html"] == draft["html"]
    assert detail["candidate"]["source"] == draft["source"]
    assert detail["html"] == result["html"]
    assert detail["source"] == result["source"]
    assert len(detail["versions"]) == 1
    assert detail["project"]["currentVersionId"] == published["versionId"]
    assert pg_store.get_version(project["id"], owner)["version"]["source"] == result["source"]
    assert pg_store.get_published(published["slug"])["html"] == result["html"]
    resumed = pg_store.resume_run(project["id"], owner, job["id"])
    assert resumed["id"] == job["id"]
    assert pg_store.get_project(project["id"], owner)["candidate"]["runId"] == job["id"]
    replacement = pg_store.claim_run("resumed")
    assert pg_store.complete_run(job["id"], replacement["lease_token"], draft)
    accepted = pg_store.get_project(project["id"], owner)
    assert accepted["candidate"] is None
    assert accepted["html"] == draft["html"]
    assert accepted["source"] == draft["source"]
    assert len(accepted["versions"]) == 2
    assert pg_store.get_published(published["slug"])["html"] == result["html"]


def test_new_request_hides_obsolete_candidate_and_keeps_saved_checkpoints(
    pg_store, project, owner, result, monkeypatch
):
    old = start(pg_store, project, owner)
    saved = save_candidate(pg_store, old, result)
    pg_store.cancel_run(project["id"], owner, old["id"])
    replacement = start(pg_store, project, owner, "Different request")
    assert pg_store.get_project(project["id"], owner)["candidate"] is None
    with pg_store.sessions() as session:
        assert (
            session.get(RunCheckpoint, (old["id"], "flow-v1/candidate/000000")).result
            == (saved["value"])
        )
    # Same-millisecond checkpoints must still select the latest operation.
    clock = saved["createdAt"]
    monkeypatch.setattr(
        "formlane.storage.timestamp", lambda now=None: clock if now is None else now
    )
    save_candidate(pg_store, replacement, result, index=1, compiled=False)
    compiled = {**result, "html": "<!doctype html><html><body>Newest candidate</body></html>"}
    save_candidate(pg_store, replacement, compiled, index=2)
    detail = pg_store.get_project(project["id"], owner)
    assert detail["candidate"]["runId"] == replacement["id"]
    assert detail["candidate"]["html"] == compiled["html"]
    assert detail["candidate"]["artifactHash"] == artifact_hash(compiled["html"])


@pytest.mark.parametrize("restore", [False, True])
def test_stale_baseline_hides_candidate_without_deleting_history(
    pg_store, project, owner, result, restore
):
    complete(pg_store, project, owner, result)
    baseline = pg_store.get_project(project["id"], owner)["project"]["currentVersionId"]
    complete(pg_store, project, owner, result, "Second accepted version")
    job = start(pg_store, project, owner, "Draft against the second version")
    saved = save_candidate(pg_store, job, result)
    pg_store.cancel_run(project["id"], owner, job["id"])
    if restore:
        pg_store.restore_version(project["id"], owner, baseline)
    else:
        # Exercise the baseline guard independently of recovery eligibility.
        with pg_store.sessions.begin() as session:
            session.get(Project, project["id"]).current_version_id = baseline
    detail = pg_store.get_project(project["id"], owner)
    assert detail["candidate"] is None
    assert detail["project"]["currentVersionId"] == baseline
    with pg_store.sessions() as session:
        assert (
            session.get(RunCheckpoint, (job["id"], "flow-v1/candidate/000000")).result
            == (saved["value"])
        )
    with pytest.raises(StoreError) as blocked:
        pg_store.resume_run(project["id"], owner, job["id"])
    assert blocked.value.status == 409


@pytest.mark.parametrize("version", ["crew-v1", "dbos-v1", "flow-v2"])
def test_scheduler_skips_incompatible_queued_runs(pg_store, project, owner, version):
    incompatible = pg_store.create_run(project["id"], owner, "Old queued run")
    with pg_store.sessions.begin() as session:
        session.get(Run, incompatible["id"]).execution_version = version
    assert pg_store.claim_run("worker") is None
    other = pg_store.create_project(owner, "Compatible app")
    compatible = pg_store.create_run(other["id"], owner)
    claimed = pg_store.claim_run("worker")
    assert claimed["id"] == compatible["id"]
    assert claimed["execution_version"] == EXECUTION_VERSION
    with pg_store.sessions() as session:
        untouched = session.get(Run, incompatible["id"])
        assert untouched.status == "queued" and untouched.lease_token is None


class OrderedCheckpoints(Checkpoints):
    """Reject nested operations, as DBOS does, and retain committed replay results."""

    def __init__(self):
        super().__init__()
        self.active = False

    def run(self, name, fn):
        assert not self.active, "Candidate persistence must not nest durable steps"
        self.active = True
        try:
            return super().run(name, fn)
        finally:
            self.active = False


def test_candidate_operations_replay_snapshots_without_repeating_tools(monkeypatch, result):
    journal = OrderedCheckpoints()
    rt, _ = runtime(result["source"])
    rt.durable = journal
    rt.scope = rt.new_scope("flow-v1/build", "alex")
    compiled_sources = []

    def compile_source(source, *_):
        compiled_sources.append(copy.deepcopy(source))
        return {"sourceHash": source_hash(source), "html": result["html"]}

    monkeypatch.setattr("formlane.delivery.workspace.compile_project", compile_source)
    operations = [
        (WriteFile, {"path": "draft.js", "content": "const draft = 1"}),
        (BuildProject, {}),
        (EditFile, {"path": "draft.js", "edits": [{"find": "1", "replacement": "2"}]}),
        (DeleteFile, {"path": "draft.js"}),
    ]
    for tool, args in operations:
        assert "error" not in tool(rt).run(**args)
    candidates = [value for key, value in journal.values.items() if "/candidate/" in key]
    assert len(candidates) == 4
    assert candidates[0]["source"]["files"]["draft.js"] == "const draft = 1"
    assert candidates[0]["html"] is None and candidates[0]["artifactHash"] is None
    assert candidates[1]["html"] == result["html"]
    assert candidates[1]["artifactHash"] == artifact_hash(result["html"])
    assert candidates[2]["source"]["files"]["draft.js"] == "const draft = 2"
    assert candidates[2]["html"] is None and candidates[2]["artifactHash"] is None
    assert "draft.js" not in candidates[3]["source"]["files"]
    saved = copy.deepcopy(journal.values)
    replay, _ = runtime(result["source"])
    replay.durable = journal
    replay.scope = replay.new_scope("flow-v1/build", "alex")

    def forbid_repetition(operation):
        @wraps(operation)
        def repeated_operation(*_):
            pytest.fail("A committed tool must restore its snapshot during replay")

        monkeypatch.setattr(replay, operation.__name__, repeated_operation)

    for operation in (replay.write_file, replay.build_project, replay.edit_file, replay.delete_file):
        forbid_repetition(operation)
    for tool, args in operations:
        tool(replay).run(**args)
    assert journal.values == saved
    assert replay.workspace == rt.workspace
    assert len(compiled_sources) == 1
