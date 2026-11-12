import copy
import multiprocessing
import os
import signal
import subprocess
import sys
import time
from concurrent.futures import CancelledError
from uuid import uuid4

import pytest
from test_storage import postgres_store, start

from formlane.storage import LeaseLost
from formlane.worker import (
    MAX_ATTEMPTS,
    Durable,
    RunTimeout,
    failure_for,
    process_tree,
    provider_retryable,
    terminate_tree,
)


class MemoryStore:
    def __init__(self):
        self.checkpoints = {}
        self.events = []
        self.writable = True

    def get_checkpoint(self, run, lease, name):
        if not self.writable:
            raise LeaseLost()
        return self.checkpoints.get(name)

    def put_checkpoint(self, run, lease, name, value):
        if not self.writable:
            raise LeaseLost()
        return self.checkpoints.setdefault(name, {"value": copy.deepcopy(value), "createdAt": 0})

    def append_event(self, run, lease, key, kind, data):
        if not self.writable:
            raise LeaseLost()
        self.events.append((key, kind, copy.deepcopy(data)))


def job():
    return {"id": "run", "lease_token": "lease", "deadline_at": int(time.time() * 1000) + 900_000}


def test_checkpoint_commits_before_next_step_and_recovers_json_null():
    store = MemoryStore()
    durable = Durable(store, job(), lambda: False)
    assert durable.run("null", lambda: None) is None
    assert durable.run("null", lambda: pytest.fail("Completed step repeated")) is None
    assert durable.run("next", lambda: store.checkpoints["null"]["value"]) is None
    assert set(store.checkpoints) == {"null", "next"}


def test_checkpoint_failure_never_advances_or_returns_uncommitted_value():
    store = MemoryStore()
    durable = Durable(store, job(), lambda: False)

    def lost_during_work():
        store.writable = False
        return {"source": "uncommitted"}

    with pytest.raises(LeaseLost):
        durable.run("step", lost_during_work)
    assert store.checkpoints == {}


def test_nested_event_scopes_and_execution_namespaces_are_distinct():
    store = MemoryStore()
    durable = Durable(store, job(), lambda: False)

    def parent():
        durable.emit("agent_start", {"id": "alex"})
        durable.run("child", lambda: durable.emit("file_delta", {"text": "live"}))
        durable.emit("agent_end", {"id": "alex"})

    durable.run("parent", parent)
    keys = [entry[0] for entry in store.events]
    assert len(set(keys)) == 3
    assert keys[0].endswith(":parent:0:0")
    assert keys[1].endswith(":child:0:0")
    assert keys[2].endswith(":parent:0:1")
    other = Durable(store, job(), lambda: False)
    assert other.execution_id != durable.execution_id


def test_provider_retries_are_bounded_and_cancel_before_retry(monkeypatch):
    store = MemoryStore()
    clock = [0.0]
    monkeypatch.setattr("formlane.worker.time.monotonic", lambda: clock[0])
    durable = Durable(
        store, job(), lambda: False, sleep=lambda seconds: clock.__setitem__(0, clock[0] + seconds)
    )
    calls = []

    class Transient(Exception):
        status_code = 503

    def fail():
        calls.append(1)
        raise Transient("private provider response")

    with pytest.raises(Transient):
        durable.run("retry", fail)
    assert len(calls) == MAX_ATTEMPTS
    assert clock[0] >= 130
    cancelled = [False]
    durable = Durable(store, job(), lambda: cancelled[0])

    def cancel_then_fail():
        cancelled[0] = True
        raise Transient()

    with pytest.raises(CancelledError):
        durable.run("cancel", cancel_then_fail)


def test_deadline_is_persisted_budget_and_errors_are_public_safe():
    expired = job()
    expired["deadline_at"] = int(time.time() * 1000) - 1
    with pytest.raises(RunTimeout):
        Durable(MemoryStore(), expired, lambda: False).run(
            "late", lambda: pytest.fail("Expired work ran")
        )
    error = RuntimeError("sk-secret database-password provider response")
    assert failure_for(error)["code"] == "internal"
    assert "sk-secret" not in str(failure_for(error))
    assert "database-password" not in str(failure_for(error))
    assert provider_retryable(type("RateLimitError", (Exception,), {})())
    assert not provider_retryable(type("AuthenticationError", (Exception,), {})())


def test_real_postgresql_durable_restart_and_cancellation_fence():
    with postgres_store() as store:
        owner = str(uuid4())
        project = store.create_project(owner, "Durable checkpoint")
        claimed = start(store, project, owner)
        first = Durable(store, claimed, lambda: False)
        first.run("completed-step", lambda: {"source": {"files": {"a.js": "saved"}}})
        restarted = Durable(store, claimed, lambda: False)
        value = restarted.run(
            "completed-step", lambda: pytest.fail("Restart repeated a completed step")
        )
        assert value["source"]["files"]["a.js"] == "saved"
        store.cancel_run(project["id"], owner, claimed["id"])
        with pytest.raises(LeaseLost):
            restarted.run("late-step", lambda: "must not run")


def _stubborn_tree(connection):
    os.setsid()
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    descendant = subprocess.Popen(
        [
            sys.executable,
            "-c",
            "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)",
        ],
        start_new_session=True,
    )
    connection.send(descendant.pid)
    connection.close()
    while True:
        time.sleep(1)


def test_hard_cancellation_kills_blocked_child_and_detached_descendant():
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    process = context.Process(target=_stubborn_tree, args=(send,))
    cancellation = context.Event()
    process.start()
    send.close()
    try:
        assert receive.poll(10)
        descendant = receive.recv()
        known = set(process_tree(process.pid))
        assert descendant in {pid for pid, _, _ in known}
        terminate_tree(process, cancellation, known)
        assert not process.is_alive()
        assert cancellation.is_set()
        # An unreaped zombie is dead; it cannot make provider calls or run generated JS.
        status = subprocess.run(
            ["ps", "-o", "stat=", "-p", str(descendant)], capture_output=True, text=True, timeout=2
        )
        assert not status.stdout.strip() or status.stdout.strip().startswith("Z")
    finally:
        if process.is_alive():
            terminate_tree(process, cancellation)
        receive.close()
        process.close()
