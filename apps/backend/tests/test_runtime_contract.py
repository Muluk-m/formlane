"""Upgrade contracts for the installed CrewAI runtime (transport only is recorded).

The companion test_durable_execution.py owns real PostgreSQL/DBOS process-death,
retry, scheduling-connection loss and cancellation fencing; these tests do not
substitute an in-memory journal for that recovery evidence.
"""

import json
from concurrent.futures import CancelledError
from threading import Event, get_ident
from types import SimpleNamespace

import pytest
from crewai import Agent, Crew, Process, Task
from crewai.events import Depends, LLMStreamChunkEvent, crewai_event_bus
from crewai.hooks import HookAborted, InterceptionPoint
from crewai.hooks.dispatch import scoped_hooks
from crewai.llms.providers.openai.completion import OpenAICompletion
from crewai.tools.base_tool import Tool
from openai.types.chat import ChatCompletionChunk
from pydantic import BaseModel

from formlane.delivery._crewai import ObservedOpenAI, SourceExecutor
from formlane.delivery.errors import RuntimeAbort
from formlane.delivery.workspace import Runtime
from formlane.worker import Durable


class WriteArgs(BaseModel):
    path: str
    content: str


def chunk(delta, finish_reason=None):
    return ChatCompletionChunk(
        id="contract-response",
        created=0,
        model="contract-model",
        object="chat.completion.chunk",
        choices=[{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    )


def argument_chunk(fragment, *, index=0, first=False):
    return chunk(
        {
            "tool_calls": [
                {
                    "index": index,
                    "id": f"write-{index}" if first else None,
                    "type": "function",
                    "function": {
                        "name": "write_file" if first else None,
                        "arguments": fragment,
                    },
                }
            ]
        }
    )


def native_model(monkeypatch, transport, model_type=OpenAICompletion):
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=transport)))
    monkeypatch.setattr(OpenAICompletion, "_get_sync_client", lambda _: client)
    return model_type(
        model="contract-model",
        api_key="contract-transport-only",
        base_url="http://127.0.0.1:1/v1",
        custom_openai=True,
        stream=True,
        max_retries=0,
        additional_params={"parallel_tool_calls": False},
    )


def native_crew(llm, write_file, *, terminal=True):
    tool = Tool(
        name="write_file",
        description="Write a source file",
        args_schema=WriteArgs,
        func=write_file,
        result_as_answer=terminal,
    )
    agent = Agent(
        role="Alex",
        goal="Write the requested source",
        backstory="Source implementation",
        llm=llm,
        tools=[tool],
        max_iter=4,
        max_retry_limit=0,
        cache=False,
        verbose=False,
        executor_class=SourceExecutor,
    )
    task = Task(description="Write the requested files.", expected_output="Saved", agent=agent)
    return Crew(
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        cache=False,
        tracing=False,
        verbose=False,
    )


class ProviderAttempts:
    """Exercise retries without replacing the native provider or executor.

    Durable.events is the actual application ContextVar scope. No database work
    happens here; persisted retry/replay semantics belong to the companion suite.
    """

    def __init__(self, attempts=1):
        self.attempts = attempts
        self.scopes = Durable(None, {}, lambda: False)
        self.calls = []

    def run(self, name, function):
        for attempt in range(self.attempts):
            self.calls.append((name, attempt))
            with self.scopes.events(name, attempt):
                try:
                    return function()
                except ConnectionError:
                    if attempt + 1 == self.attempts:
                        raise
        raise AssertionError("Provider attempt loop did not return")


def observed_runtime(journal, events):
    runtime = Runtime(
        None,
        {"runId": "runtime-contract"},
        journal,
        lambda kind, data: events.append((kind, data)),
        lambda: False,
    )
    runtime.scope = runtime.new_scope("flow-v1/build", "alex")
    return runtime


def test_native_argument_deltas_are_visible_while_transport_is_still_streaming(monkeypatch):
    events = []
    saved = []
    between_chunks = []
    journal = ProviderAttempts()
    runtime = observed_runtime(journal, events)
    first = '{"path":"src/main.js","content":"const text = '
    second = '\\"hello\\";\\n"}'

    def transport(**kwargs):
        assert kwargs["stream"] is True
        yield argument_chunk(first, first=True)
        between_chunks.append((list(events), list(saved)))
        yield argument_chunk(second)
        yield chunk({}, "tool_calls")

    def write_file(path, content):
        saved.append((path, content, list(events)))
        return "Saved"

    llm = native_model(monkeypatch, transport, ObservedOpenAI).bind(runtime)
    assert native_crew(llm, write_file).kickoff().raw == "Saved"
    partial_events, partial_saved = between_chunks[0]
    assert partial_saved == []
    assert ("file_delta", {"path": "src/main.js", "text": "const text = "}) in partial_events
    assert [(path, content) for path, content, _ in saved] == [
        ("src/main.js", 'const text = "hello";\n')
    ]
    assert "".join(data["text"] for kind, data in saved[0][2] if kind == "file_delta") == (
        'const text = "hello";\n'
    )
    assert journal.calls == [("flow-v1/build/llm-0", 0)]


def test_native_provider_retry_discards_partial_arguments_before_reusing_call_index(monkeypatch):
    events = []
    saved = []
    journal = ProviderAttempts(attempts=2)
    runtime = observed_runtime(journal, events)
    requests = 0

    def transport(**kwargs):
        nonlocal requests
        requests += 1
        if requests == 1:
            yield argument_chunk('{"path":"src/main.js","content":"discarded', first=True)
            raise ConnectionError("Recorded transport interruption")
        yield argument_chunk('{"path":"src/main.js","content":"accepted', first=True)
        yield argument_chunk('"}')
        yield chunk({}, "tool_calls")

    def write_file(path, content):
        saved.append((path, content))
        return "Saved"

    llm = native_model(monkeypatch, transport, ObservedOpenAI).bind(runtime)
    assert native_crew(llm, write_file).kickoff().raw == "Saved"
    assert saved == [("src/main.js", "accepted")]
    assert [(kind, data) for kind, data in events if kind.startswith("file_") or kind == "project_reset"] == [
        ("project_reset", {"source": None}),
        ("file_start", {"path": "src/main.js", "agent": "alex"}),
        ("file_delta", {"path": "src/main.js", "text": "discarded"}),
        ("project_reset", {"source": None}),
        ("file_start", {"path": "src/main.js", "agent": "alex"}),
        ("file_delta", {"path": "src/main.js", "text": "accepted"}),
    ]
    assert journal.calls == [("flow-v1/build/llm-0", 0), ("flow-v1/build/llm-0", 1)]


def test_native_batch_executes_nonterminal_tools_sequentially_on_provider_thread(monkeypatch):
    timeline = []
    tool_threads = []
    provider_threads = []
    requests = []

    def transport(**kwargs):
        provider_threads.append(get_ident())
        requests.append(kwargs)
        if len(requests) == 1:
            # Deliberately violate the provider flag. Neither tool is terminal or
            # max-usage-limited, so CrewAI's default executor would parallelize.
            for index, content in enumerate(("first", "second")):
                yield argument_chunk(
                    json.dumps({"path": "src/main.js", "content": content}),
                    index=index,
                    first=True,
                )
            yield chunk({}, "tool_calls")
        else:
            yield chunk({"content": "Both saved"})
            yield chunk({}, "stop")

    def write_file(path, content):
        tool_threads.append(get_ident())
        timeline.append(("start", content))
        timeline.append(("finish", content))
        return f"Saved {content}"

    llm = native_model(monkeypatch, transport)
    assert native_crew(llm, write_file, terminal=False).kickoff().raw == "Both saved"
    assert requests[0]["parallel_tool_calls"] is False
    assert timeline == [
        ("start", "first"), ("finish", "first"),
        ("start", "second"), ("finish", "second"),
    ]
    assert tool_threads == [provider_threads[0], provider_threads[0]]
    assert [message["content"] for message in requests[1]["messages"] if message["role"] == "tool"] == [
        "Saved first", "Saved second"
    ]


@pytest.mark.parametrize("relay_reason", [False, True])
def test_official_pre_tool_abort_needs_post_hook_to_deliver_decide_now_reason(monkeypatch, relay_reason):
    reason = "write_file budget reached for this stage. Decide now from the evidence already collected."
    calls = []
    executed = []
    tool_results = []
    requests = []
    journal = ProviderAttempts()

    def before(context):
        calls.append((context.tool_name, dict(context.tool_input)))
        if len(calls) == 2:
            raise HookAborted(reason)

    def after(context):
        tool_results.append(context.tool_result)
        if relay_reason and len(calls) == 2:
            return reason
        return None

    def transport(**kwargs):
        requests.append(kwargs)
        if len(requests) == 1:
            for index, content in enumerate(("allowed", "blocked")):
                yield argument_chunk(
                    json.dumps({"path": "src/main.js", "content": content}),
                    index=index,
                    first=True,
                )
            yield chunk({}, "tool_calls")
        else:
            yield chunk({"content": "Decision recorded"})
            yield chunk({}, "stop")

    def write_file(path, content):
        def save():
            executed.append(content)
            return "Saved"

        return journal.run("flow-v1/build/tool-0-write_file", save)

    llm = native_model(monkeypatch, transport)
    with scoped_hooks({InterceptionPoint.PRE_TOOL_CALL: [before], InterceptionPoint.POST_TOOL_CALL: [after]}):
        result = native_crew(llm, write_file, terminal=False).kickoff()
    assert result.raw == "Decision recorded"
    assert calls == [
        ("write_file", {"path": "src/main.js", "content": "allowed"}),
        ("write_file", {"path": "src/main.js", "content": "blocked"}),
    ]
    assert executed == ["allowed"]
    assert journal.calls == [("flow-v1/build/tool-0-write_file", 0)]
    generic = "Tool execution blocked by hook. Tool: write_file"
    assert tool_results == ["Saved", generic]
    assert [message["content"] for message in requests[1]["messages"] if message["role"] == "tool"] == [
        "Saved", reason if relay_reason else generic
    ]


def test_official_pre_tool_hook_propagates_authority_abort_before_any_tool_effect(monkeypatch):
    executed = []
    seen = []
    cause = CancelledError()

    def before(context):
        seen.append(context.tool_name)
        raise RuntimeAbort(cause)

    def transport(**kwargs):
        yield argument_chunk('{"path":"src/main.js","content":"late"}', first=True)
        yield chunk({}, "tool_calls")

    def write_file(path, content):
        executed.append(content)
        return "Saved"

    llm = native_model(monkeypatch, transport)
    with scoped_hooks({InterceptionPoint.PRE_TOOL_CALL: [before]}):
        with pytest.raises(RuntimeAbort) as aborted:
            native_crew(llm, write_file).kickoff()
    assert aborted.value.cause is cause
    assert seen == ["write_file"]
    assert executed == []


def test_official_stream_listener_preserves_delta_order_and_live_durable_scope(monkeypatch):
    durable = Durable(None, {}, lambda: False)
    seen = []
    timeline = []
    emitting_thread = []
    fragments = ['{"path":"src/main.js","content":"first', ' second"}']

    def listener(source, event):
        scope = durable.scope.get()
        seen.append((event.chunk, event.tool_call, dict(scope), get_ident()))
        timeline.append("chunk")

    def transport(**kwargs):
        emitting_thread.append(get_ident())
        yield chunk({"content": "Writing source"})
        yield argument_chunk(fragments[0], first=True)
        yield argument_chunk(fragments[1])
        yield chunk({}, "tool_calls")

    def write_file(path, content):
        timeline.append("tool")
        return "Saved"

    llm = native_model(monkeypatch, transport)
    with crewai_event_bus.scoped_handlers():
        crewai_event_bus.on(LLMStreamChunkEvent)(listener)
        with durable.events("flow-v1/build/llm-0", attempt=1):
            assert native_crew(llm, write_file).kickoff().raw == "Saved"
    assert durable.scope.get() is None
    assert timeline == ["chunk", "chunk", "chunk", "tool"]
    assert [item[0] for item in seen] == ["Writing source", *fragments]
    assert seen[0][1] is None
    assert [item[1].function.arguments for item in seen[1:]] == [
        fragments[0], "".join(fragments)
    ]
    assert all(item[2] == {"name": "flow-v1/build/llm-0", "attempt": 1, "index": 0} for item in seen)
    assert [item[3] for item in seen] == [emitting_thread[0]] * 3


def test_official_listener_dependency_dispatch_can_outlive_durable_scope(monkeypatch):
    durable = Durable(None, {}, lambda: False)
    release = Event()
    entered = Event()
    seen = []
    scope_is_live = False
    provider_thread = get_ident()

    def first(source, event):
        entered.set()
        if not release.wait(timeout=5):
            return
        seen.append(("first", scope_is_live, get_ident()))

    def second(source, event):
        seen.append(("second", scope_is_live, get_ident()))

    def transport(**kwargs):
        yield chunk({"content": "Finished"})
        yield chunk({}, "stop")

    llm = native_model(monkeypatch, transport)
    with crewai_event_bus.scoped_handlers():
        crewai_event_bus.on(LLMStreamChunkEvent)(first)
        crewai_event_bus.on(LLMStreamChunkEvent, depends_on=Depends(first))(second)
        try:
            with durable.events("flow-v1/build/llm-0"):
                scope_is_live = True
                assert llm.call("Describe the result") == "Finished"
                assert entered.wait(timeout=5)
                assert seen == [], "Provider returned while the stream listener was still blocked"
            scope_is_live = False
        finally:
            release.set()
            assert crewai_event_bus.flush(timeout=5)
    assert durable.scope.get() is None
    assert [(name, live) for name, live, _ in seen] == [("first", False), ("second", False)]
    assert all(thread != provider_thread for _, _, thread in seen)


def test_official_stream_listener_swallows_ordinary_observation_errors(monkeypatch):
    seen = []

    def listener(source, event):
        seen.append(event.chunk)
        raise RuntimeError("Recorded observer failure")

    def transport(**kwargs):
        yield chunk({"content": "Still completes"})
        yield chunk({}, "stop")

    llm = native_model(monkeypatch, transport)
    with crewai_event_bus.scoped_handlers():
        crewai_event_bus.on(LLMStreamChunkEvent)(listener)
        result = llm.call("Describe the result")
    assert seen == ["Still completes"]
    assert result == "Still completes"


def test_official_stream_listener_authority_abort_stops_provider_and_tool_execution(monkeypatch):
    consumed = []
    executed = []
    cause = CancelledError()

    def listener(source, event):
        raise RuntimeAbort(cause)

    def transport(**kwargs):
        consumed.append("first")
        yield chunk({"content": "Starting"})
        consumed.append("late")
        yield argument_chunk('{"path":"src/main.js","content":"late"}', first=True)
        yield chunk({}, "tool_calls")

    def write_file(path, content):
        executed.append(content)
        return "Saved"

    llm = native_model(monkeypatch, transport)
    with crewai_event_bus.scoped_handlers():
        crewai_event_bus.on(LLMStreamChunkEvent)(listener)
        with pytest.raises(RuntimeAbort) as aborted:
            native_crew(llm, write_file).kickoff()
    assert aborted.value.cause is cause
    assert consumed == ["first"]
    assert executed == []


@pytest.mark.parametrize("model_type", [OpenAICompletion, ObservedOpenAI])
def test_chat_completion_reasoning_fields_never_become_public_tokens(monkeypatch, model_type):
    official_chunks = []
    events = []
    journal = ProviderAttempts()
    runtime = observed_runtime(journal, events)

    def listener(source, event):
        official_chunks.append(event.chunk)

    def transport(**kwargs):
        yield chunk({"reasoning_content": "private-reasoning", "reasoning": "private-reasoning"})
        yield chunk({"content": "Public summary"})
        yield chunk({}, "stop")

    llm = native_model(monkeypatch, transport, model_type)
    if model_type is ObservedOpenAI:
        llm.bind(runtime)
    with crewai_event_bus.scoped_handlers():
        crewai_event_bus.on(LLMStreamChunkEvent)(listener)
        assert llm.call("Describe the result") == "Public summary"
    if model_type is OpenAICompletion:
        assert official_chunks == ["Public summary"]
    else:
        assert [data["text"] for kind, data in events if kind == "token"] == ["Public summary"]
    assert "private-reasoning" not in json.dumps([official_chunks, events])
