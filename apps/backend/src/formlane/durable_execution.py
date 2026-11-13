"""DBOS 3.5 execution, explicitly bootstrapped and subordinate to the run lease.

Only run IDs are workflow inputs. Live credentials, cancellation and lease tokens
stay in this process. A private queue per producer prevents another DBOS worker
from executing a run without its application lease. Never enqueue these workflows
through Conductor or an independently managed queue worker.
"""

from __future__ import annotations

import argparse
import hashlib
import threading
import uuid
from dataclasses import dataclass, field
from importlib.metadata import version
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from dbos import DBOS, SetWorkflowID

from ._dbos import resume_on_connection
from .settings import Settings
from .storage import EXECUTION_VERSION

# flow-v1 replaced the hierarchical crew (ADR-0015); its histories are not interchangeable.
APPLICATION_VERSION = EXECUTION_VERSION
WORKFLOW_NAME = "formlane.flow.v1"
INCOMPATIBLE_MESSAGE = (
    "This run requires its original execution version and cannot resume on this deployment."
)


class ExecutionVersionMismatch(Exception):
    code = "internal"


class ExecutionInterrupted(BaseException):
    """Leave the unfinished DBOS step uncommitted, without persisting exceptions.

    DBOS 3.5.0 records Exception outcomes, but propagates BaseException without
    recording an operation error. This pinned behavior is exercised by the real
    PostgreSQL process-death/resume tests. The application records sanitized failure
    state; only a new lease and explicit resume after terminal failure can retry it.
    """

    def __init__(self, cause: BaseException):
        self.cause = cause
        super().__init__("Durable execution interrupted.")


def compatibility_manifest(settings: Settings) -> dict:
    # A source/config change must not silently replay a different native agent loop.
    # Keep this version's code available until its resumable runs have drained;
    # a future incompatible version needs a deliberate migration/version handler.
    root = Path(__file__).parent
    files = (
        "delivery/__init__.py",
        "delivery/_crewai.py",
        "delivery/errors.py",
        "delivery/flow.py",
        "delivery/schemas.py",
        "delivery/stages.py",
        "delivery/tools.py",
        "delivery/workspace.py",
        "model_stream.py",
        "delivery/configuration.py",
        "project.py",
        "compiler.py",
        "validator.py",
        "worker.py",
        "durable_execution.py",
    )
    endpoint = urlsplit(settings.endpoint)
    return {
        "version": APPLICATION_VERSION,
        "dbos": version("dbos"),
        "crewai": version("crewai"),
        "source": {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in files},
        "model": settings.model,
        # Neither URL credentials nor query parameters enter execution history.
        "endpoint": [endpoint.scheme, endpoint.hostname, endpoint.port, endpoint.path],
    }


@dataclass
class ExecutionSession:
    durable: Any
    invoke: Callable[[], dict]
    manifest: dict
    failed: threading.Event = field(default_factory=threading.Event)
    error: BaseException | None = None


_session: ExecutionSession | None = None


def resume_with_authority(runtime, settings: Settings, durable, queue: str) -> None:
    """Keep the application lease locked throughout the SDK queue mutation."""
    with durable.store.scheduling_authority(
        durable.job["id"], durable.job["lease_token"]
    ) as connection:
        resume_on_connection(
            runtime, connection, settings.dbos_system_schema, durable.job["id"], queue
        )


@DBOS.workflow(name=WORKFLOW_NAME, max_recovery_attempts=None, auto_upgrade=False)
def run_flow(run_id: str) -> dict:
    session = _session
    # Queue delivery is never an authorization grant. This process can execute
    # precisely the run its supervisor claimed, with the current live lease.
    if session is None or session.durable.job["id"] != run_id:
        raise ExecutionInterrupted(RuntimeError("No authorized run execution context."))
    try:
        session.durable.check()
        saved = session.durable.run("flow-v1/execution-manifest", lambda: session.manifest)
        if saved != session.manifest:
            raise ExecutionVersionMismatch(INCOMPATIBLE_MESSAGE)
        result = session.durable.orchestrate("flow-v1/result", session.invoke)
        session.durable.check()
        return result
    except BaseException as error:
        cause = getattr(error, "cause", error)
        session.error = cause
        session.failed.set()
        # The public run owns terminal failure and cancellation. Do not poison
        # DBOS history with a replayed provider error or serialize its secrets.
        raise ExecutionInterrupted(cause) from None


def execute_durable(settings: Settings, durable: Any, invoke: Callable[[], dict]) -> dict:
    """Recover exactly one leased run, including after a hard process death."""
    global _session
    if durable.job["execution_version"] != APPLICATION_VERSION:
        raise ExecutionVersionMismatch(INCOMPATIBLE_MESSAGE)
    durable.check()
    session = ExecutionSession(durable, invoke, compatibility_manifest(settings))
    _session = session
    execution_id = uuid.uuid4().hex
    queue = f"formlane-{execution_id}"
    run_id = durable.job["id"]
    constructed = False
    try:
        runtime = DBOS(
            config={
                "name": "formlane",
                "application_version": APPLICATION_VERSION,
                # Never recover arbitrary old executors automatically: Store.claim_run
                # is the sole scheduler, and this identity has never owned a workflow.
                "executor_id": execution_id,
                "system_database_url": settings.durable_database_url,
                "dbos_system_schema": settings.dbos_system_schema,
                "run_migrations": False,
                "enable_otlp": False,
                "log_level": "CRITICAL",
                "max_executor_threads": 2,
                "sys_db_pool_size": 4,
            }
        )
        constructed = True
        DBOS.listen_queues([queue])
        DBOS.launch()
        durable.check()
        status = DBOS.get_workflow_status(run_id)
        if status is not None and (
            status.name != WORKFLOW_NAME
            or status.app_version != APPLICATION_VERSION
            or status.application_name != "formlane"
        ):
            raise ExecutionVersionMismatch(INCOMPATIBLE_MESSAGE)
        if status is not None and status.status == "SUCCESS":
            result = DBOS.retrieve_workflow(run_id).get_result()
            durable.check()
            return result
        if status is not None and status.status == "ERROR":
            # This integration never records workflow errors. An ERROR indicates
            # incompatible/foreign execution, not permission to discard history.
            raise ExecutionVersionMismatch(INCOMPATIBLE_MESSAGE)
        DBOS.register_queue(queue, worker_concurrency=1, polling_interval_sec=0.1)
        if status is None:
            # Creation is idempotent and never dispatches work. A stale enqueue
            # cannot strand a replacement: every producer schedules under its lease.
            DBOS.register_queue("formlane-unscheduled", worker_concurrency=1)
            durable.check()
            with SetWorkflowID(run_id):
                DBOS.enqueue_workflow("formlane-unscheduled", run_flow, run_id)
        resume_with_authority(runtime, settings, durable, queue)
        handle = DBOS.retrieve_workflow(run_id)
        while True:
            durable.check()
            if session.failed.wait(0.1):
                assert session.error is not None
                raise session.error
            status = DBOS.get_workflow_status(run_id)
            if status is not None and status.status == "SUCCESS":
                result = handle.get_result()
                durable.check()
                return result
            if status is not None and status.status in {
                "ERROR",
                "CANCELLED",
                "MAX_RECOVERY_ATTEMPTS_EXCEEDED",
            }:
                raise RuntimeError("Durable workflow stopped without a committed result.")
    finally:
        # Do not cancel here: a newer application lease may already have resumed
        # this same workflow. Killing the process stops live work; only the next
        # authorized producer may rotate DBOS ownership under the application fence.
        if constructed:
            DBOS.destroy()
        _session = None


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Explicit DBOS schema migration; never on startup."
    )
    parser.add_argument("command", choices=["migrate"])
    parser.add_argument("--application-role", help="Runtime PostgreSQL role to grant DML access")
    args = parser.parse_args()
    settings = Settings()
    DBOS.migrate(
        settings.durable_database_url,
        schema=settings.dbos_system_schema,
        application_role=args.application_role,
    )


if __name__ == "__main__":
    main()
