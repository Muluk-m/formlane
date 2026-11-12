"""Real DBOS/PostgreSQL replay across spawned-process death and explicit resume.

TEST_DATABASE_URL must be the dedicated PostgreSQL test database. Business and
DBOS tables each use disposable, independently named schemas. Only provider
transport is synthetic; native CrewAI delegation/executor/tool execution is real.
"""

import copy
import json
import multiprocessing
import time
from collections import Counter
from contextlib import contextmanager
from uuid import uuid4

import pytest
from dbos import DBOS, DBOSClient
from dbos import error as dbos_error
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError
from test_storage import start

from formlane.durable_execution import (
    ExecutionVersionMismatch,
    execute_durable,
    resume_with_authority,
)
from formlane.models import Run
from formlane.project import create_source
from formlane.settings import Settings
from formlane.storage import LeaseLost, Store, timestamp
from formlane.worker import Durable

SOURCE_TEXT = "document.querySelector('#app').textContent = 'Durably saved';"
WRITE_ARGS = {"path": "src/main.js", "content": SOURCE_TEXT}
TOOL_CALL = [
    {
        "id": "saved-write",
        "type": "function",
        "function": {"name": "write_file", "arguments": json.dumps(WRITE_ARGS)},
    }
]
DELEGATION = "crew-v1/delegate-0-alex"


@pytest.fixture
def durable_database(pg_store):
    schema = "test_dbos_" + uuid4().hex
    settings = Settings(
        database_url=pg_store.engine.url.render_as_string(hide_password=False),
        dbos_system_schema=schema,
        openai_api_key="test-provider-secret-never-in-history",
        endpoint="http://127.0.0.1:1/v1",
        model="test",
    )
    # Explicit bootstrap is part of the test's setup, not application startup.
    DBOS.migrate(settings.durable_database_url, schema=schema)
    with pg_store.engine.begin() as connection:
        connection.execute(text("CREATE TABLE execution_effects (name text NOT NULL)"))
    try:
        yield settings
    finally:
        DBOS.destroy()
        with pg_store.engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def _record(store, name):
    with store.engine.begin() as connection:
        connection.execute(text("INSERT INTO execution_effects VALUES (:name)"), {"name": name})


def _effect_counts(store):
    with store.engine.connect() as connection:
        return Counter(connection.execute(text("SELECT name FROM execution_effects")).scalars())


def _block(connection, state):
    connection.send({"state": state})
    while True:
        time.sleep(0.1)


def _native_child(settings_data, job, connection, mode):
    from crewai import Crew, Process, Task
    from crewai.llms.providers.openai.completion import OpenAICompletion

    from formlane.agents import DurableAgent, Runtime, SourceExecutor
    from formlane.model_stream import ObservedOpenAI

    settings = Settings.model_validate(settings_data)
    store = Store(settings.database_url)
    durable = Durable(store, job, lambda: False)
    try:

        def invoke():
            context = store.harness_context(job["id"], job["lease_token"])
            context["previousSource"] = create_source("vanilla")
            runtime = Runtime(settings, context, durable, durable.emit, lambda: False)
            original_operation = runtime.operation

            def operation(name, args):
                _record(store, name)
                return original_operation(name, args)

            runtime.operation = operation

            def provider(llm, *args, **kwargs):
                index = runtime.scope["llm_index"] - 1
                _record(store, f"model-{index}")
                if index == 0:
                    return copy.deepcopy(TOOL_CALL)
                if mode == "kill-model":
                    _block(connection, "unfinished-model")
                if mode == "provider-failure":
                    raise ConnectionError("test-provider-secret-never-in-history")
                return "Saved source."

            OpenAICompletion.call = provider
            llm = ObservedOpenAI(
                model="test",
                api_key=settings.openai_api_key,
                base_url=settings.endpoint,
                api="completions",
                stream=True,
                max_retries=0,
            ).bind(runtime)
            agent = DurableAgent(
                role="Alex",
                goal="Save the source",
                backstory="Implement source",
                llm=llm,
                tools=runtime.tools("alex"),
                allow_delegation=False,
                max_iter=4,
                max_retry_limit=0,
                cache=False,
                checkpoint=False,
                verbose=False,
                executor_class=SourceExecutor,
            ).bind(runtime, "alex")
            task = Task(description="Save src/main.js", expected_output="Source saved", agent=agent)
            crew = Crew(
                agents=[agent],
                tasks=[task],
                process=Process.sequential,
                cache=False,
                memory=False,
                tracing=False,
                verbose=False,
                checkpoint=False,
            )
            try:
                output = crew.kickoff()
                if mode == "kill-after-delegation":
                    _block(connection, "completed-delegation")
                return {
                    "source": runtime.workspace["source"],
                    "html": "<!doctype html><html><body>Durably saved</body></html>",
                    "summary": output.raw,
                    "revision": runtime.workspace["revision"],
                    "implementationPasses": runtime.workspace["implementationPasses"],
                }
            finally:
                if llm._client is not None:
                    llm._client.close()

        if mode == "kill-after-enqueue":
            enqueue = DBOS.enqueue_workflow

            def pause_enqueue(*args, **kwargs):
                enqueue(*args, **kwargs)
                _block(connection, "unscheduled-workflow")

            DBOS.enqueue_workflow = pause_enqueue

        result = execute_durable(settings, durable, invoke)
        connection.send({"state": "result", "result": result})
        if mode == "kill-after-result":
            while True:
                time.sleep(0.1)
    except BaseException as error:
        connection.send({"state": "error", "type": type(error).__name__})
    finally:
        store.close()
        connection.close()


@contextmanager
def _producer(settings, job, mode):
    context = multiprocessing.get_context("spawn")
    receive, send = context.Pipe(duplex=False)
    process = context.Process(target=_native_child, args=(settings.model_dump(), job, send, mode))
    process.start()
    send.close()
    try:
        yield process, receive
    finally:
        if process.is_alive():
            process.kill()
        process.join(timeout=10)
        assert not process.is_alive()
        receive.close()
        process.close()


def _receive(connection):
    assert connection.poll(45), "Durable producer did not reach its expected operation boundary"
    return connection.recv()


def _reclaim(store, job):
    with store.sessions.begin() as session:
        session.get(Run, job["id"]).lease_expires_at = timestamp() - 1
    replacement = store.claim_run(str(uuid4()))
    assert replacement["id"] == job["id"]
    assert replacement["lease_token"] != job["lease_token"]
    assert replacement["attempt"] == job["attempt"]
    return replacement


def _seed_legacy(store, job, completed_delegation=False, completed_result=False):
    from formlane.agents import Runtime

    with store.sessions.begin() as session:
        session.get(Run, job["id"]).execution_version = "crew-v1"
    job["execution_version"] = "crew-v1"
    context = store.harness_context(job["id"], job["lease_token"])
    context["previousSource"] = create_source("vanilla")
    runtime = Runtime(None, context, None, lambda *_: None, lambda: False)
    runtime.scope = runtime.new_scope(DELEGATION, "alex")
    runtime.operation("write_file", WRITE_ARGS)
    saved = {
        "output": {"path": "src/main.js", "revision": 1},
        "workspace": copy.deepcopy(runtime.workspace),
        "mutated": True,
        "args": WRITE_ARGS,
    }
    store.put_checkpoint(job["id"], job["lease_token"], f"{DELEGATION}/llm-0", TOOL_CALL)
    store.put_checkpoint(job["id"], job["lease_token"], f"{DELEGATION}/tool-0-write_file", saved)
    result = {
        "source": runtime.workspace["source"],
        "html": "<!doctype html><html><body>Legacy saved</body></html>",
        "summary": "Legacy source saved.",
        "revision": 1,
        "implementationPasses": 1,
    }
    if completed_delegation:
        store.put_checkpoint(
            job["id"],
            job["lease_token"],
            DELEGATION,
            {
                "workspace": runtime.workspace,
                "result": json.dumps(
                    {"result": "Legacy source saved.", "workspace": runtime.workspace_info()}
                ),
            },
        )
    if completed_result:
        store.put_checkpoint(job["id"], job["lease_token"], "crew-v1/result", result)
    return result


@pytest.mark.parametrize("legacy", [False, True])
def test_process_death_replays_native_model_and_tool_without_repeating_saved_effects(
    pg_store, project, owner, durable_database, legacy
):
    job = start(pg_store, project, owner)
    if legacy:
        _seed_legacy(pg_store, job)
    with _producer(durable_database, job, "kill-model") as (process, receive):
        assert _receive(receive) == {"state": "unfinished-model"}
        process.kill()
        process.join(timeout=10)
    assert _effect_counts(pg_store) == (
        Counter({"model-1": 1})
        if legacy
        else Counter({"model-0": 1, "write_file": 1, "model-1": 1})
    )
    replacement = _reclaim(pg_store, job)
    with pytest.raises(LeaseLost):
        pg_store.check_authority(job["id"], job["lease_token"])
    with _producer(durable_database, replacement, "finish") as (_, receive):
        receipt = _receive(receive)
    assert receipt["state"] == "result", receipt
    result = receipt["result"]
    assert result["source"]["files"]["src/main.js"] == SOURCE_TEXT
    assert result["revision"] == result["implementationPasses"] == 1
    counts = _effect_counts(pg_store)
    assert counts["write_file"] == counts["model-0"] == (0 if legacy else 1)
    # An interrupted, uncommitted provider request can execute and be billed again.
    assert counts["model-1"] == 2
    schema = durable_database.dbos_system_schema
    with pg_store.engine.connect() as connection:
        rows = connection.execute(
            text(
                f'SELECT function_name,error FROM "{schema}".operation_outputs WHERE workflow_uuid=:id'
            ),
            {"id": job["id"]},
        ).all()
    names = {row.function_name for row in rows}
    assert f"{DELEGATION}/llm-0" in names
    assert f"{DELEGATION}/tool-0-write_file" in names
    assert f"{DELEGATION}/llm-1" in names
    assert "crew-v1/result" not in names and DELEGATION not in names
    assert all(row.error is None for row in rows)


def test_process_death_before_dispatch_recovers_unscheduled_workflow(
    pg_store, project, owner, durable_database
):
    job = start(pg_store, project, owner)
    with _producer(durable_database, job, "kill-after-enqueue") as (process, receive):
        assert _receive(receive)["state"] == "unscheduled-workflow"
        process.kill()
        process.join(timeout=10)
    assert _effect_counts(pg_store) == Counter()
    replacement = _reclaim(pg_store, job)
    with _producer(durable_database, replacement, "finish") as (_, receive):
        receipt = _receive(receive)
    assert receipt["state"] == "result", receipt
    assert receipt["result"]["source"]["files"]["src/main.js"] == SOURCE_TEXT
    assert _effect_counts(pg_store) == Counter({"model-0": 1, "write_file": 1, "model-1": 1})


def test_lost_scheduling_connection_cannot_overwrite_replacement_queue(
    pg_store, project, owner, durable_database
):
    job = start(pg_store, project, owner)
    with _producer(durable_database, job, "kill-model") as (process, receive):
        assert _receive(receive)["state"] == "unfinished-model"
        process.kill()
        process.join(timeout=10)
    client = DBOSClient(
        system_database_url=durable_database.database_url,
        dbos_system_schema=durable_database.dbos_system_schema,
        application_name="formlane",
    )
    interrupted = False

    def interrupt(connection, cursor, statement, parameters, context, executemany):
        nonlocal interrupted
        if interrupted or not statement.startswith("UPDATE") or "workflow_status" not in statement:
            return
        interrupted = True
        pid = connection.connection.driver_connection.info.backend_pid
        with pg_store.engine.connect() as admin:
            assert admin.execute(text("SELECT pg_terminate_backend(:pid)"), {"pid": pid}).scalar()
        replacement = _reclaim(pg_store, job)
        resume_with_authority(
            client,
            durable_database,
            Durable(pg_store, replacement, lambda: False),
            "replacement-owner",
        )

    event.listen(pg_store.engine, "before_cursor_execute", interrupt)
    try:
        with pytest.raises(DBAPIError):
            resume_with_authority(
                client, durable_database, Durable(pg_store, job, lambda: False), "stale-owner"
            )
        assert interrupted
        assert client.retrieve_workflow(job["id"]).get_status().queue_name == "replacement-owner"
    finally:
        event.remove(pg_store.engine, "before_cursor_execute", interrupt)
        client.destroy()


@pytest.mark.parametrize("completed_result", [False, True])
def test_completed_legacy_aggregate_survives_importer_process_death(
    pg_store, project, owner, durable_database, completed_result
):
    job = start(pg_store, project, owner)
    saved = _seed_legacy(
        pg_store, job, completed_delegation=True, completed_result=completed_result
    )
    mode = "kill-after-result" if completed_result else "kill-after-delegation"
    with _producer(durable_database, job, mode) as (process, receive):
        receipt = _receive(receive)
        assert receipt["state"] == ("result" if completed_result else "completed-delegation")
        process.kill()
        process.join(timeout=10)
    replacement = _reclaim(pg_store, job)
    with _producer(durable_database, replacement, "finish") as (_, receive):
        receipt = _receive(receive)
    assert receipt["state"] == "result", receipt
    assert receipt["result"]["source"] == saved["source"]
    assert _effect_counts(pg_store) == Counter()


def test_failed_provider_retries_only_unfinished_operation_on_same_run_resume(
    pg_store, project, owner, durable_database
):
    job = start(pg_store, project, owner)
    with _producer(durable_database, job, "provider-failure") as (_, receive):
        receipt = _receive(receive)
    assert receipt == {"state": "error", "type": "ConnectionError"}
    assert pg_store.finish_run(job["id"], job["lease_token"], "failed", "provider", "safe")
    resumed = pg_store.resume_run(project["id"], owner, job["id"])
    assert resumed["id"] == job["id"] and resumed["attempt"] == 2
    replacement = pg_store.claim_run(str(uuid4()))
    with _producer(durable_database, replacement, "finish") as (_, receive):
        receipt = _receive(receive)
    assert receipt["state"] == "result", receipt
    assert _effect_counts(pg_store) == Counter({"model-0": 1, "write_file": 1, "model-1": 2})
    # Inspect deserialized workflow/step history through the public DBOS client;
    # secrets must not merely be hidden in a serialized/pickled string.
    from dbos import DBOSClient

    client = DBOSClient(
        system_database_url=durable_database.durable_database_url,
        dbos_system_schema=durable_database.dbos_system_schema,
        application_name="formlane",
    )
    try:
        history = repr(client.retrieve_workflow(job["id"]).get_status().__dict__)
        history += repr(client.list_workflow_steps(job["id"]))
        for secret in (
            durable_database.openai_api_key,
            job["lease_token"],
            replacement["lease_token"],
            durable_database.database_url,
        ):
            assert secret not in history
    finally:
        client.destroy()


def test_cancelled_old_producer_cannot_commit_late_model_or_publish(
    pg_store, project, owner, durable_database
):
    job = start(pg_store, project, owner)
    with _producer(durable_database, job, "kill-model") as (_, receive):
        assert _receive(receive)["state"] == "unfinished-model"
        pg_store.cancel_run(project["id"], owner, job["id"])
        assert _receive(receive) == {"state": "error", "type": "LeaseLost"}
    pg_store.resume_run(project["id"], owner, job["id"])
    replacement = pg_store.claim_run(str(uuid4()))
    with _producer(durable_database, replacement, "finish") as (_, receive):
        receipt = _receive(receive)
    assert receipt["state"] == "result", receipt
    assert _effect_counts(pg_store)["write_file"] == 1
    assert not pg_store.complete_run(job["id"], job["lease_token"], receipt["result"])


def test_runtime_refuses_missing_dbos_schema_without_creating_it(pg_store, project, owner):
    job = start(pg_store, project, owner)
    settings = Settings(
        database_url=pg_store.engine.url.render_as_string(hide_password=False),
        dbos_system_schema="absent_" + uuid4().hex,
    )
    try:
        with pytest.raises(dbos_error.DBOSInitializationError):
            execute_durable(settings, Durable(pg_store, job, lambda: False), lambda: {})
        with pg_store.engine.connect() as connection:
            assert (
                connection.execute(
                    text("SELECT 1 FROM pg_namespace WHERE nspname=:schema"),
                    {"schema": settings.dbos_system_schema},
                ).first()
                is None
            )
    finally:
        DBOS.destroy()


def test_unknown_execution_version_fails_closed_before_running_work(pg_store, project, owner):
    job = start(pg_store, project, owner)
    job["execution_version"] = "future-incompatible"
    settings = Settings(database_url=pg_store.engine.url.render_as_string(hide_password=False))
    with pytest.raises(ExecutionVersionMismatch):
        execute_durable(settings, Durable(pg_store, job, lambda: False), lambda: pytest.fail("Ran"))


def test_changed_execution_manifest_rejects_replay_without_repeating_effects(
    pg_store, project, owner, durable_database
):
    job = start(pg_store, project, owner)
    with _producer(durable_database, job, "kill-model") as (process, receive):
        assert _receive(receive)["state"] == "unfinished-model"
        process.kill()
        process.join(timeout=10)
    before = _effect_counts(pg_store)
    replacement = _reclaim(pg_store, job)
    changed = durable_database.model_copy(update={"model": "different-model"})
    with _producer(changed, replacement, "finish") as (_, receive):
        assert _receive(receive) == {"state": "error", "type": "ExecutionVersionMismatch"}
    assert _effect_counts(pg_store) == before
    assert pg_store.fail_incompatible_run(replacement["id"], replacement["lease_token"])
    assert not pg_store.get_run(project["id"], owner, job["id"])["resumable"]
