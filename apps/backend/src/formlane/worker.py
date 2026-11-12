"""Independent PostgreSQL worker with fenced steps and killable execution trees."""

from __future__ import annotations

import contextvars
import json
import logging
import multiprocessing
import os
import random
import signal
import socket
import subprocess
import threading
import time
import uuid
from concurrent.futures import CancelledError
from contextlib import contextmanager
from typing import Any, Callable

from dbos import DBOS
from sqlalchemy.exc import SQLAlchemyError

from .durable_execution import ExecutionInterrupted, ExecutionVersionMismatch, execute_durable
from .settings import Settings
from .storage import LeaseLost, Store

LOG = logging.getLogger(__name__)
HEARTBEAT_SECONDS = 10
MAX_ATTEMPTS = 5


class RunTimeout(Exception):
    code = "timeout"


def provider_retryable(error: BaseException) -> bool:
    status = getattr(error, "status_code", getattr(error, "status", None))
    if isinstance(status, int):
        return status == 429 or status >= 500
    return type(error).__name__ in {
        "APIConnectionError",
        "APITimeoutError",
        "APIConnectionTimeoutError",
        "RateLimitError",
        "InternalServerError",
        "RemoteProtocolError",
        "ReadError",
    }


def failure_for(error: BaseException) -> dict:
    code = getattr(error, "code", None)
    if code == "timeout" or isinstance(error, RunTimeout):
        return {
            "code": "timeout",
            "message": "Generation exceeded its execution budget. Your previous version is unchanged.",
        }
    if code == "step_limit":
        return {
            "code": "step_limit",
            "message": "The agent reached its step limit before validation and review could finish. Your previous version is unchanged.",
        }
    if code == "validation":
        return {
            "code": "validation",
            "message": "The generated app did not pass validation after repair. Your previous version is unchanged.",
        }
    if (
        code == "provider"
        or provider_retryable(error)
        or type(error).__name__
        in {
            "APIError",
            "APIStatusError",
            "AuthenticationError",
            "PermissionDeniedError",
            "BadRequestError",
            "NotFoundError",
            "UnprocessableEntityError",
        }
    ):
        return {
            "code": "provider",
            "message": "The model provider could not complete this run. Check the provider configuration and try again.",
        }
    return {
        "code": "internal",
        "message": "Generation could not complete. Your previous version is unchanged. Please try again.",
    }


class Durable:
    """DBOS operation results with a fenced application commit/import journal."""

    def __init__(
        self,
        store: Store,
        job: dict,
        cancelled: Callable[[], bool],
        sleep: Callable[[float], Any] = time.sleep,
    ):
        self.store, self.job, self.cancelled, self.sleep = store, job, cancelled, sleep
        self.execution_id = uuid.uuid4().hex
        self.scope: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
            "checkpoint_scope", default=None
        )

    def check(self) -> None:
        if self.cancelled():
            raise CancelledError()
        if int(time.time() * 1000) >= self.job["deadline_at"]:
            raise RunTimeout()
        self.store.check_authority(self.job["id"], self.job["lease_token"])

    @contextmanager
    def events(self, name: str, attempt: int = 0):
        token = self.scope.set({"name": name, "attempt": attempt, "index": 0})
        try:
            yield
        finally:
            self.scope.reset(token)

    def step(self, name: str, function: Callable[[], Any]) -> Any:
        self.check()
        if DBOS.workflow_id is None or DBOS.step_id is not None:
            raise RuntimeError("Durable operations require a workflow, never an outer step.")

        def invoke():
            try:
                self.check()
                return function()
            except BaseException as error:
                # DBOS must not checkpoint a failed provider call, lease loss or
                # cancellation. Only successful operations are replayable.
                raise ExecutionInterrupted(getattr(error, "cause", error)) from None

        try:
            result = DBOS.run_step({"name": name}, invoke)
        except ExecutionInterrupted as error:
            raise error.cause from None
        # DBOS skips invoke entirely when replaying: fence cached returns too.
        self.check()
        return result

    def orchestrate(self, name: str, function: Callable[[], Any]) -> Any:
        """Import an immutable legacy aggregate, or run orchestration outside steps.

        The import decision is itself durable, so later replay takes the identical
        branch. Never wrap a delegation/crew in a step: DBOS swallows nested steps.
        """
        with self.events(name):
            saved = self.step(
                f"{name}/legacy-import",
                lambda: self.store.get_checkpoint(self.job["id"], self.job["lease_token"], name),
            )
            if saved is not None:
                return saved["value"]
            result = function()
            self.check()
            return result

    def run(self, name: str, function: Callable[[], Any]) -> Any:
        def perform():
            saved = self.store.get_checkpoint(self.job["id"], self.job["lease_token"], name)
            if saved is not None:
                return saved["value"]
            for attempt in range(MAX_ATTEMPTS):
                with self.events(name, attempt):
                    try:
                        value = function()
                        self.check()
                        value = json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))
                        # This fenced journal also closes a DBOS-commit failure
                        # window and imports pre-DBOS completed model/tool effects.
                        saved = self.store.put_checkpoint(
                            self.job["id"], self.job["lease_token"], name, value
                        )
                        self.check()
                        return saved["value"]
                    except Exception as error:
                        self.check()
                        if not provider_retryable(error) or attempt + 1 == MAX_ATTEMPTS:
                            raise
                        delay = min(60.0, 10.0 * 2**attempt)
                        until = time.monotonic() + delay
                        while time.monotonic() < until:
                            self.check()
                            self.sleep(min(0.2, max(0.0, until - time.monotonic())))
            raise RuntimeError("Unreachable retry state")

        return self.step(name, perform)

    def emit(self, event_type: str, data: dict) -> None:
        self.check()
        scope = self.scope.get()
        if scope is None:
            raise RuntimeError("Harness events require a durable scope.")
        key = f"{self.execution_id}:{scope['name']}:{scope['attempt']}:{scope['index']}"
        scope["index"] += 1
        self.store.append_event(self.job["id"], self.job["lease_token"], key, event_type, data)


def _child(settings_data: dict, job: dict, connection: Any, cancellation: Any) -> None:
    # Every compiler/browser descendant remains discoverable beneath this session.
    os.setsid()
    signal.signal(signal.SIGTERM, lambda *_: cancellation.set())
    signal.signal(signal.SIGINT, lambda *_: cancellation.set())
    # SDK exception logging may contain provider response bodies; parent logs safe codes only.
    with open(os.devnull, "w") as sink:
        os.dup2(sink.fileno(), 1)
        os.dup2(sink.fileno(), 2)
    settings = Settings.model_validate(settings_data)
    store = Store(settings.database_url)
    durable = Durable(store, job, cancellation.is_set)
    try:
        from .agents import execute_harness

        context = store.harness_context(job["id"], job["lease_token"])
        result = execute_durable(
            settings,
            durable,
            lambda: execute_harness(settings, context, durable, durable.emit, cancellation.is_set),
        )
        durable.check()
        # Completion stays in the child: large source/HTML never block the supervisor pipe.
        completed = store.complete_run(job["id"], job["lease_token"], result)
        connection.send({"state": "completed" if completed else "released"})
    except (LeaseLost, SQLAlchemyError, CancelledError):
        connection.send({"state": "released"})
    except ExecutionVersionMismatch:
        connection.send({"state": "incompatible"})
    except BaseException as error:
        cause = getattr(error, "cause", error)
        if isinstance(cause, (LeaseLost, SQLAlchemyError, CancelledError)):
            connection.send({"state": "released"})
        else:
            connection.send({"state": "failed", **failure_for(cause)})
    finally:
        store.engine.dispose()
        connection.close()


def process_snapshot() -> dict[int, tuple[int, int, str]]:
    result = subprocess.run(
        ["ps", "-eo", "pid=,ppid=,pgid=,lstart="],
        capture_output=True,
        text=True,
        timeout=2,
        check=True,
    )
    rows = [row.split(maxsplit=3) for row in result.stdout.splitlines() if row.strip()]
    return {int(pid): (int(parent), int(group), started) for pid, parent, group, started in rows}


def process_tree(root: int) -> list[tuple[int, int, str]]:
    """Capture descendant identity, including independently sessioned browsers."""
    rows = process_snapshot()
    descendants = {root}
    while True:
        discovered = {pid for pid, (parent, _, _) in rows.items() if parent in descendants}
        if discovered.issubset(descendants):
            break
        descendants.update(discovered)
    return [
        (pid, group, started) for pid, (_, group, started) in rows.items() if pid in descendants
    ]


def terminate_tree(process: Any, cancellation: Any, known: set | None = None) -> None:
    """Cooperate briefly, then kill captured descendants whose identity still matches."""
    cancellation.set()
    descendants = set(known or ())
    try:
        descendants.update(process_tree(process.pid))
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    try:
        os.kill(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    process.join(timeout=1)
    try:
        descendants.update(process_tree(process.pid))
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    own_group = os.getpgrp()
    try:
        live = process_snapshot()
    except (OSError, ValueError, subprocess.SubprocessError):
        live = {}
    for pid, group, started in descendants:
        identity = live.get(pid)
        if identity is None or identity[2] != started:
            continue
        try:
            if group != own_group and identity[1] == group:
                os.killpg(group, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if process.is_alive():
        process.kill()
    process.join(timeout=2)


def execute_job(settings: Settings, store: Store, job: dict, shutdown: threading.Event) -> None:
    context = multiprocessing.get_context("spawn")
    cancellation = context.Event()
    receive, send = context.Pipe(duplex=False)
    process = context.Process(
        target=_child,
        args=(settings.model_dump(), job, send, cancellation),
        name=f"formlane-run-{job['id']}",
    )
    heartbeat_stop = threading.Event()
    authority_lost = threading.Event()
    last_heartbeat = [time.monotonic()]

    def heartbeat() -> None:
        while not heartbeat_stop.is_set():
            try:
                if not store.heartbeat(job["id"], job["lease_token"]):
                    authority_lost.set()
                    cancellation.set()
                    return
                last_heartbeat[0] = time.monotonic()
            except Exception:
                # Uncertain authority releases execution; no provider error is written.
                authority_lost.set()
                cancellation.set()
                return
            heartbeat_stop.wait(HEARTBEAT_SECONDS)

    monitor = threading.Thread(target=heartbeat, daemon=True, name="run-heartbeat")
    process.start()
    send.close()
    monitor.start()
    state = None
    descendants: set[tuple[int, int, str]] = set()
    next_snapshot = 0.0
    try:
        while True:
            if time.monotonic() >= next_snapshot:
                try:
                    descendants.update(process_tree(process.pid))
                except (OSError, ValueError, subprocess.SubprocessError):
                    pass
                next_snapshot = time.monotonic() + 1
            if (
                shutdown.is_set()
                or authority_lost.is_set()
                or time.monotonic() - last_heartbeat[0] >= 45
            ):
                break
            if int(time.time() * 1000) >= job["deadline_at"]:
                state = {"state": "failed", **failure_for(RunTimeout())}
                break
            if receive.poll(0.2):
                try:
                    state = receive.recv()
                except EOFError:
                    state = {"state": "released"}
                break
            if not process.is_alive():
                state = {"state": "released"}
                break
    finally:
        heartbeat_stop.set()
        terminate_tree(process, cancellation, descendants)
        receive.close()
        monitor.join(timeout=2)
        process.close()
    if state and state["state"] == "incompatible":
        try:
            store.fail_incompatible_run(job["id"], job["lease_token"])
        except (LeaseLost, SQLAlchemyError):
            pass
        LOG.warning("run_incompatible run_id=%s", job["id"])
        return
    if (
        state
        and state["state"] == "failed"
        and not shutdown.is_set()
        and not authority_lost.is_set()
    ):
        try:
            store.finish_run(
                job["id"], job["lease_token"], "failed", state["code"], state["message"]
            )
        except (LeaseLost, SQLAlchemyError):
            pass
        LOG.warning("run_failed run_id=%s code=%s", job["id"], state["code"])
    elif state and state["state"] == "completed":
        LOG.info("run_completed run_id=%s", job["id"])
    else:
        LOG.info("run_released run_id=%s", job["id"])


def run_worker(settings: Settings, shutdown: threading.Event | None = None) -> None:
    if not settings.worker_enabled:
        LOG.info("worker_disabled")
        return
    shutdown = shutdown or threading.Event()
    store = Store(settings.database_url)
    worker_id = f"{socket.gethostname()}:{uuid.uuid4()}"
    try:
        while not shutdown.is_set():
            try:
                store.expire_runs()
                job = store.claim_run(worker_id)
                if job:
                    execute_job(settings, store, job, shutdown)
                else:
                    shutdown.wait(2)
            except Exception:
                LOG.warning("worker_poll_unavailable")
                shutdown.wait(5 + random.random())
    finally:
        store.engine.dispose()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    shutdown = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: shutdown.set())
    signal.signal(signal.SIGINT, lambda *_: shutdown.set())
    run_worker(Settings(), shutdown)


if __name__ == "__main__":
    main()
