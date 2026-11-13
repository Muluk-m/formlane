import copy
import json
import os
from concurrent.futures import CancelledError
from contextlib import nullcontext
from types import SimpleNamespace

os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CREWAI_TRACING_ENABLED"] = "false"

import pytest
from crewai import Agent, Crew, Process, Task
from crewai.llms.providers.openai.completion import OpenAICompletion
from crewai.tools.base_tool import Tool
from openai.types.chat import ChatCompletionChunk
from pydantic import BaseModel

from formlane.agents import Delivery, Runtime, SourceExecutor, checks_hash
from formlane.model_stream import FileJsonStream, ObservedOpenAI, RuntimeAbort, StreamObserver
from formlane.project import artifact_hash, create_source, source_hash


@pytest.mark.parametrize(
    "content",
    ['line\nquotes " slash \\ tab\t', "Emoji: 😀; 中文", "", "<script>const x = '<a>'</script>"],
)
@pytest.mark.parametrize("path_first", [True, False])
def test_json_boundaries_unicode_and_reordered_fields(content, path_first):
    args = (
        {"path": "src/main.ts", "content": content}
        if path_first
        else {"content": content, "path": "src/main.ts"}
    )
    data = json.dumps(args, ensure_ascii=True)
    for width in (1, 2, 7, len(data)):
        reader = FileJsonStream()
        output = []
        for position in range(0, len(data), width):
            path, delta = reader.push(data[position : position + width])
            output.append(delta)
        assert path == "src/main.ts"
        assert "".join(output) == content


def test_stream_ignores_nested_content_and_invalid_paths():
    reader = FileJsonStream()
    assert (
        reader.push(
            '{"other":{"path":"secret.js","content":"not a source file"},"path":"../bad.js","content":"bad"}'
        )[1]
        == ""
    )
    assert reader.invalid
    reader = FileJsonStream()
    assert reader.push('{"path":"ok.js","content":"\\uD800"}')[1] == ""
    assert reader.invalid


def test_argument_deltas_are_observed_before_execution_and_never_duplicated():
    events = []
    observer = StreamObserver(
        lambda kind, data: events.append((kind, data)), lambda: False, "alex", "message"
    )
    observer.chunk(
        '{"path":"src/a.js","content":"first', {"index": 0, "function": {"name": "write_file"}}
    )
    assert events == [
        ("file_start", {"path": "src/a.js", "agent": "alex"}),
        ("file_delta", {"path": "src/a.js", "text": "first"}),
    ]
    observer.chunk(' second"}', {"index": 0, "function": {"name": "write_file"}})
    observer.flush()
    assert "".join(data["text"] for kind, data in events if kind == "file_delta") == "first second"
    assert not any(kind == "file_saved" for kind, _ in events)


def test_stream_cancellation_fences_remaining_fragments():
    cancelled = [False]
    observer = StreamObserver(lambda *_: None, lambda: cancelled[0], "alex", "message")
    observer.chunk('{"path":"a.js","content":"x', {"index": 0, "function": {"name": "write_file"}})
    cancelled[0] = True
    with pytest.raises(CancelledError):
        observer.chunk('y"}', {"index": 0, "function": {"name": "write_file"}})


class MemoryDurable:
    def __init__(self):
        self.results = {}

    def run(self, name, function):
        if name not in self.results:
            self.results[name] = copy.deepcopy(function())
        return copy.deepcopy(self.results[name])

    def orchestrate(self, name, function):
        return function()

    def events(self, name, attempt=0):
        return nullcontext()


def test_real_crewai_executor_receives_native_stream_before_running_tool(monkeypatch):
    """Runs CrewAI's real Crew/Agent/native OpenAI provider; only transport is synthetic."""
    events = []
    saved = []
    runtime = Runtime(
        None,
        {"runId": "stream-test"},
        MemoryDurable(),
        lambda kind, data: events.append((kind, data)),
        lambda: False,
    )
    runtime.scope = runtime.new_scope("test/alex", "alex")
    payload = json.dumps({"path": "src/main.js", "content": "const result = 42;"})

    def stream(**kwargs):
        assert kwargs["stream"] is True
        for index, fragment in enumerate([payload[:40], payload[40:]]):
            yield ChatCompletionChunk(
                id="response",
                created=0,
                model="test",
                object="chat.completion.chunk",
                choices=[
                    {
                        "index": 0,
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call" if index == 0 else None,
                                    "type": "function",
                                    "function": {
                                        "name": "write_file" if index == 0 else None,
                                        "arguments": fragment,
                                    },
                                }
                            ]
                        },
                        "finish_reason": None,
                    }
                ],
            )
        yield ChatCompletionChunk(
            id="response",
            created=0,
            model="test",
            object="chat.completion.chunk",
            choices=[{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
        )

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=stream)))
    monkeypatch.setattr(OpenAICompletion, "_get_sync_client", lambda _: client)
    llm = ObservedOpenAI(
        model="test",
        api_key="transport-test",
        base_url="http://127.0.0.1:1/v1",
        custom_openai=True,
        stream=True,
        max_retries=0,
        additional_params={"parallel_tool_calls": False},
    ).bind(runtime)

    class WriteInput(BaseModel):
        path: str
        content: str

    def write_file(path, content):
        assert any(kind == "file_delta" for kind, _ in events), (
            "Native provider must emit arguments before native tool execution"
        )
        saved.append((path, content))
        return "Source saved"

    tool = Tool(
        name="write_file",
        description="Write a source file",
        args_schema=WriteInput,
        func=write_file,
        result_as_answer=True,
    )
    agent = Agent(
        role="Alex",
        goal="Write the requested source",
        backstory="Source implementation",
        llm=llm,
        tools=[tool],
        max_iter=3,
        max_retry_limit=0,
        cache=False,
        verbose=False,
        executor_class=SourceExecutor,
    )
    task = Task(
        description="Write src/main.js containing const result = 42;",
        expected_output="Source saved",
        agent=agent,
    )
    result = Crew(
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        cache=False,
        tracing=False,
        verbose=False,
    ).kickoff()
    assert saved == [("src/main.js", "const result = 42;")]
    assert result.raw == "Source saved"
    assert runtime.scope["llm_index"] == 1, (
        "The terminal tool must finish without another model response"
    )
    assert (
        "".join(data["text"] for kind, data in events if kind == "file_delta")
        == "const result = 42;"
    )
    assert runtime.durable.results["test/alex/llm-0"][0]["function"]["name"] == "write_file"


def test_failed_provider_attempt_does_not_reuse_partial_reader(monkeypatch):
    events = []
    attempts = [0]

    class RetryDurable:
        def run(self, name, fn):
            try:
                return fn()
            except ConnectionError:
                return fn()

    runtime = Runtime(
        None,
        {"runId": "stream-test"},
        RetryDurable(),
        lambda kind, data: events.append((kind, data)),
        lambda: False,
    )
    runtime.scope = runtime.new_scope("step", "alex")

    def native_call(llm, *args):
        attempts[0] += 1
        text = "discarded" if attempts[0] == 1 else "accepted"
        llm._emit_stream_chunk_event(
            '{"path":"a.js","content":"' + text,
            tool_call={"index": 0, "function": {"name": "write_file"}},
        )
        if attempts[0] == 1:
            raise ConnectionError("transport disconnected")
        llm._emit_stream_chunk_event(
            '"}', tool_call={"index": 0, "function": {"name": "write_file"}}
        )
        return "finished"

    monkeypatch.setattr(OpenAICompletion, "call", native_call)
    llm = ObservedOpenAI(model="test", api_key="transport-test").bind(runtime)
    assert llm.call("task") == "finished"
    assert [kind for kind, _ in events].count("project_reset") == 2
    assert [data["text"] for kind, data in events if kind == "file_delta"] == [
        "discarded",
        "accepted",
    ]
    assert llm._observer is None


def test_provider_exception_cannot_become_native_tool_error_text(monkeypatch):
    runtime = Runtime(
        None, {"runId": "stream-test"}, MemoryDurable(), lambda *_: None, lambda: False
    )
    runtime.scope = runtime.new_scope("step", "alex")

    def fail(*args):
        raise ValueError("credential-material-must-not-be-public")

    monkeypatch.setattr(OpenAICompletion, "call", fail)
    llm = ObservedOpenAI(model="test", api_key="transport-test").bind(runtime)
    with pytest.raises(RuntimeAbort) as error:
        llm.call("task")
    assert "credential-material" not in str(error.value)
    assert "credential-material" in str(error.value.cause)


def test_resumed_stage_replays_saved_model_calls_without_new_provider_requests(monkeypatch):
    durable = MemoryDurable()
    calls = []

    def provider(llm, *args, **kwargs):
        calls.append(llm._runtime.scope["path"])
        return "Plan considered."

    monkeypatch.setattr(OpenAICompletion, "call", provider)

    def run_stage():
        runtime = Runtime(
            None,
            {"runId": "same-run", "request": "Counter", "idea": "Counter"},
            durable,
            lambda *_: None,
            lambda: False,
        )
        return Delivery(
            runtime,
            lambda effort=None: ObservedOpenAI(model="test", api_key="test-key").bind(runtime),
        ).stage("plan-0", "planner", "Plan", {"request": "Counter"}, lambda text: text)

    first = run_stage()
    assert calls == ["flow-v1/plan-0"]
    assert run_stage() == first
    assert calls == ["flow-v1/plan-0"]


def test_native_reviewer_receives_images_before_verdict_and_replay_stays_private(monkeypatch):
    """Real CrewAI executor/provider path; only browser and HTTP transport are synthetic."""
    durable = MemoryDurable()
    events, requests, inspections = [], [], []
    encoded = "/9j/dmlzdWFsLXByaXZhdGUtZml4dHVyZQ=="
    active = []

    def inspect(html, args, *_):
        inspections.append(args)
        return {
            "accessibilityTree": "button Save",
            "screenshot": {
                "mimeType": "image/jpeg",
                "sha256": "a" * 64,
                "artifactHash": artifact_hash(html),
                "viewport": {"width": 375, "height": 812},
                "data": encoded,
            },
        }

    monkeypatch.setattr("formlane.agents.inspect_artifact", inspect)

    def stream(**kwargs):
        requests.append(copy.deepcopy(kwargs))
        image_parts = [
            part
            for message in kwargs["messages"]
            if isinstance(message.get("content"), list)
            for part in message["content"]
            if part["type"] == "image_url"
        ]
        if len(requests) == 1:
            assert not image_parts
            name, arguments = "inspect_preview", {"viewport": {"width": 375, "height": 812}}
        else:
            assert image_parts == [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{encoded}", "detail": "high"},
                }
            ]
            assert active[0].workspace["visualReview"] is None
            # Images must not be smuggled into the text portions or tool results.
            for message in kwargs["messages"]:
                content = message.get("content")
                if isinstance(content, str):
                    assert encoded not in content
                elif isinstance(content, list):
                    assert all(encoded not in part.get("text", "") for part in content)
            name, arguments = "record_review", {"accepted": True, "findings": "Layout reviewed"}
        yield ChatCompletionChunk(
            id="visual-response",
            created=0,
            model="test",
            object="chat.completion.chunk",
            choices=[
                {
                    "index": 0,
                    "delta": {
                        "tool_calls": [
                            {
                                "index": 0,
                                "id": f"call-{len(requests)}",
                                "type": "function",
                                "function": {"name": name, "arguments": json.dumps(arguments)},
                            }
                        ]
                    },
                    "finish_reason": None,
                }
            ],
        )
        yield ChatCompletionChunk(
            id="visual-response",
            created=0,
            model="test",
            object="chat.completion.chunk",
            choices=[{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
        )

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=stream)))
    monkeypatch.setattr(OpenAICompletion, "_get_sync_client", lambda _: client)

    def review():
        rt = Runtime(
            None,
            {
                "runId": "visual-run",
                "request": "Review",
                "idea": "Counter",
                "previousSource": create_source("vanilla"),
            },
            durable,
            lambda kind, data: events.append((kind, data)),
            lambda: False,
        )
        rt.scope = rt.new_scope("test/david", "david")
        rt.workspace["html"] = "<!doctype html><button>Save</button>"
        built = {
            "revision": 0,
            "sourceHash": source_hash(rt.workspace["source"]),
            "artifactHash": artifact_hash(rt.workspace["html"]),
        }
        rt.workspace.update(
            build=built,
            implementationValidation=dict(built),
            independentValidation={
                "artifactHash": built["artifactHash"],
                "checksHash": checks_hash([]),
            },
        )
        active[:] = [rt]
        llm = ObservedOpenAI(
            model="test",
            api_key="transport-test",
            custom_openai=True,
            base_url="http://127.0.0.1:1/v1",
            stream=True,
            max_retries=0,
            additional_params={"parallel_tool_calls": False},
        ).bind(rt)
        agent = Agent(
            role="David",
            goal="Review the current build",
            backstory="Independent review",
            llm=llm,
            tools=rt.tools("reviewer"),
            max_iter=4,
            max_retry_limit=0,
            cache=False,
            verbose=False,
            executor_class=SourceExecutor,
        )
        task = Task(description="Inspect and accept", expected_output="Review", agent=agent)
        agent.execute_task(task, None, agent.tools)
        assert rt.workspace["review"]["accepted"]
        assert (
            rt.workspace["review"]["visualEvidence"] == rt.workspace["visualReview"]["screenshots"]
        )
        assert encoded not in json.dumps(rt.workspace)
        assert rt.workspace["visualReview"]["modelStep"] == "test/david/llm-1"
        return rt

    first = review()
    assert len(requests) == 2 and len(inspections) == 1
    replay = review()
    assert len(requests) == 2 and len(inspections) == 1
    assert first.workspace == replay.workspace
    assert encoded not in json.dumps(events)
    saved = durable.results["test/david/tool-0-inspect_preview"]
    assert saved["output"]["screenshot"]["data"] == encoded
    assert encoded not in json.dumps(saved["workspace"])
    assert encoded not in json.dumps(durable.results["test/david/llm-1"])


def test_failed_image_provider_call_and_legacy_replay_cannot_grant_acceptance(monkeypatch):
    rt = Runtime(None, {"runId": "visual-run"}, MemoryDurable(), lambda *_: None, lambda: False)
    rt.scope = rt.new_scope("review", "david")
    rt.workspace.update(source=create_source("vanilla"), html="artifact")
    built = {
        "revision": 0,
        "sourceHash": source_hash(rt.workspace["source"]),
        "artifactHash": artifact_hash("artifact"),
    }
    rt.workspace["build"] = built
    rt.scope["images"] = [
        {
            **built,
            "sha256": "a" * 64,
            "mimeType": "image/jpeg",
            "viewport": {"width": 1280, "height": 720},
            "data": "cGl4ZWxz",
        }
    ]

    def fail(*_):
        raise ConnectionError("Interrupted before response")

    monkeypatch.setattr(OpenAICompletion, "call", fail)
    llm = ObservedOpenAI(model="test", api_key="test").bind(rt)
    with pytest.raises(RuntimeAbort):
        llm.call("Review")
    assert rt.workspace["visualReview"] is None
    rt.durable.results["review/llm-1"] = "Old text-only response"
    assert llm.call("Review") == "Old text-only response"
    assert rt.workspace["visualReview"] is None
    rt.durable.results["review/llm-2"] = {"response": "Stale", "visualEvidence": []}
    with pytest.raises(RuntimeAbort):
        llm.call("Review")
    assert rt.workspace["visualReview"] is None
