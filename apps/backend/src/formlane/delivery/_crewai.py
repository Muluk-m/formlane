"""Private compatibility boundary for pinned CrewAI provider and executor APIs.

CrewAI 1.15.40 emits argument deltas synchronously from
OpenAICompletion._handle_streaming_completion before finalizing the response.
Keep observation here so deltas precede tool execution inside the durable call.
Official LLMStreamChunkEvent dependency handlers run on another thread and may
finish after the provider returns and its durable scope closes. The installed
contract pins that failure, so retain the synchronous override and retry-local
observer rather than global listener registration. SourceExecutor disables native
parallel tool batches and reuses the native graph because this CrewAI version
discovers decorated methods on the concrete class only. Library contracts guard
these private dependencies, including reasoning privacy and client cleanup.
"""

from __future__ import annotations

from typing import Any

from crewai.agents.agent_executor import AgentExecutor
from crewai.flow.flow_definition import FlowDefinition
from crewai.llms.providers.openai.completion import OpenAICompletion
from pydantic import PrivateAttr

from ..model_stream import StreamObserver
from .errors import RuntimeAbort


class SourceExecutor(AgentExecutor):
    """Keep native tool execution ordered even if a provider ignores its flag."""

    @classmethod
    def flow_definition(cls) -> FlowDefinition:
        # CrewAI 1.15.40 only discovers decorated methods on the concrete class.
        # Reuse its native graph; methods still bind to this ordered executor.
        return AgentExecutor.flow_definition()

    def _should_parallelize_native_tool_calls(self, tool_calls: list[Any]) -> bool:
        return False


class ObservedOpenAI(OpenAICompletion):
    """Native CrewAI OpenAI provider with synchronous, durable observation hooks."""

    _runtime: Any = PrivateAttr(default=None)
    _observer: StreamObserver | None = PrivateAttr(default=None)

    def bind(self, runtime: Any) -> ObservedOpenAI:
        self._runtime = runtime
        return self

    def call(
        self,
        messages: Any,
        tools: Any = None,
        callbacks: Any = None,
        available_functions: Any = None,
        from_task: Any = None,
        from_agent: Any = None,
        response_model: Any = None,
    ) -> Any:
        if available_functions:
            raise RuntimeError("CrewAI executor must own function execution.")
        if response_model is not None:
            raise RuntimeError("Structured provider responses are not used by this harness.")
        runtime = self._runtime
        scope = runtime.scope
        index = scope["llm_index"]
        scope["llm_index"] += 1
        name = f"{scope['path']}/llm-{index}"

        def invoke() -> Any:
            runtime.begin_model_call(scope)
            # Every attempt discards unsaved file fragments and partial messages.
            runtime.emit("project_reset", {"source": runtime.workspace["source"]})
            if scope["role"] != "mike":
                runtime.emit(
                    "message_start",
                    {"id": scope["message_id"], "role": "agent", "agent": scope["role"]},
                )
            self._observer = StreamObserver(
                runtime.emit, runtime.cancelled, scope["role"], scope["message_id"]
            )
            try:
                result = super(ObservedOpenAI, self).call(
                    messages,
                    tools,
                    callbacks,
                    None,
                    from_task,
                    from_agent,
                    None,
                )
                self._observer.flush()
                runtime.check()
                return result
            finally:
                self._observer = None

        try:
            # This is one DBOS step per native provider call; delegation and
            # crew execution remain workflow orchestration, never enclosing steps.
            return runtime.durable.run(name, invoke)
        except Exception as error:
            raise RuntimeAbort(error) from None

    def _emit_stream_chunk_event(
        self,
        chunk: str,
        from_task: Any = None,
        from_agent: Any = None,
        tool_call: dict | None = None,
        call_type: Any = None,
        response_id: str | None = None,
    ) -> None:
        if self._observer is not None:
            self._observer.chunk(chunk, tool_call)

    def _emit_thinking_chunk_event(self, *args: Any, **kwargs: Any) -> None:
        # Provider reasoning is private; never send it to the conversation stream.
        return None

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
