"""Observe CrewAI's native provider stream before its executor runs tools.

Pinned to crewai 1.15.40: OpenAICompletion._handle_streaming_completion calls
_emit_stream_chunk_event with the *delta* and accumulated tool metadata before
_finalize_streaming_response. We never derive deltas from a completed tool result.
"""

from __future__ import annotations

from concurrent.futures import CancelledError
from dataclasses import dataclass, field
from typing import Any, Callable

from crewai.llms.providers.openai.completion import OpenAICompletion
from pydantic import PrivateAttr

from .project import is_project_path


class RuntimeAbort(BaseException):
    """A producer failure must bypass CrewAI's recoverable tool-error narration."""

    def __init__(self, cause: BaseException):
        self.cause = cause
        super().__init__("Execution authority or provider unavailable.")


class FileJsonStream:
    """Bounded incremental decoder of top-level write_file path/content strings."""

    def __init__(self) -> None:
        self.path: str | None = None
        self.depth = 0
        self.expecting_key = False
        self.key = ""
        self.kind: str | None = None
        self.path_value = ""
        self.before_path = ""
        self.seen: set[str] = set()
        self.escape = False
        self.unicode: str | None = None
        self.invalid = False
        self.length = 0
        self.surrogate: int | None = None

    def push(self, chunk: str) -> tuple[str | None, str]:
        output: list[str] = []

        def append(character: str) -> None:
            if self.kind == "key":
                if len(self.key) < 8:
                    self.key += character
            elif self.kind == "path":
                self.path_value += character
                if len(self.path_value) > 180:
                    self.invalid = True
            elif self.kind == "content":
                self.length += 2 if ord(character) > 0xFFFF else 1
                if self.length > 180_000:
                    self.invalid = True
                    return
                code = ord(character)
                if self.surrogate is not None:
                    if not 0xDC00 <= code <= 0xDFFF:
                        self.invalid = True
                        return
                    character = chr(0x10000 + ((self.surrogate - 0xD800) << 10) + code - 0xDC00)
                    self.surrogate = None
                elif 0xD800 <= code <= 0xDBFF:
                    self.surrogate = code
                    return
                elif 0xDC00 <= code <= 0xDFFF:
                    self.invalid = True
                    return
                if self.path:
                    output.append(character)
                else:
                    self.before_path += character

        escapes = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            "b": "\b",
            "f": "\f",
            "n": "\n",
            "r": "\r",
            "t": "\t",
        }
        for character in chunk:
            if self.invalid:
                break
            if self.kind:
                if self.unicode is not None:
                    if character not in "0123456789abcdefABCDEF":
                        self.invalid = True
                        break
                    self.unicode += character
                    if len(self.unicode) == 4:
                        append(chr(int(self.unicode, 16)))
                        self.unicode = None
                elif self.escape:
                    self.escape = False
                    if character == "u":
                        self.unicode = ""
                    elif character in escapes:
                        append(escapes[character])
                    else:
                        self.invalid = True
                elif character == "\\":
                    self.escape = True
                elif character == '"':
                    if self.surrogate is not None:
                        self.invalid = True
                    if self.kind == "path":
                        if not is_project_path(self.path_value):
                            self.invalid = True
                        else:
                            self.path = self.path_value
                            output.append(self.before_path)
                            self.before_path = ""
                    self.kind = None
                elif ord(character) < 0x20:
                    self.invalid = True
                else:
                    append(character)
                continue
            if character == '"':
                self.kind = (
                    "key"
                    if self.depth == 1 and self.expecting_key
                    else self.key
                    if self.depth == 1 and self.key in ("path", "content")
                    else "other"
                )
                if self.kind == "key":
                    self.key = ""
                elif self.kind in ("path", "content"):
                    if self.kind in self.seen:
                        self.invalid = True
                    self.seen.add(self.kind)
                self.expecting_key = False
            elif character in "{[":
                self.depth += 1
                if self.depth == 1:
                    self.expecting_key = character == "{"
            elif character in "}]":
                self.depth -= 1
            elif character == "," and self.depth == 1:
                self.expecting_key = True
                self.key = ""
        return self.path, "".join(output)


@dataclass
class FileCall:
    name: str = ""
    arguments_pending: str = ""
    text_pending: str = ""
    reader: FileJsonStream = field(default_factory=FileJsonStream)
    started: bool = False


class StreamObserver:
    def __init__(self, emit: Callable, cancelled: Callable, agent: str, message_id: str):
        self.emit = emit
        self.cancelled = cancelled
        self.agent = agent
        self.message_id = message_id
        self.calls: dict[Any, FileCall] = {}
        self.text_pending = ""

    def check(self) -> None:
        if self.cancelled():
            raise CancelledError()

    def chunk(self, text: str, tool_call: dict | None = None) -> None:
        self.check()
        if tool_call is None:
            if self.agent == "mike":
                return
            self.text_pending += text
            if len(self.text_pending) >= 160:
                self.flush_text()
            return
        call = self.calls.setdefault(tool_call.get("index", tool_call.get("id", 0)), FileCall())
        name = tool_call.get("function", {}).get("name", "")
        if name:
            # CrewAI supplies its accumulated name; tolerate split compatible names.
            call.name = name if name.startswith(call.name) else call.name + name
        if call.name != "write_file":
            if (
                "write_file".startswith(call.name)
                and len(call.arguments_pending) + len(text) <= 1_200_000
            ):
                call.arguments_pending += text
            return
        path, decoded = call.reader.push(call.arguments_pending + text)
        call.arguments_pending = ""
        if not path or not decoded:
            return
        first = not call.started
        if first:
            call.started = True
            self.emit("file_start", {"path": path, "agent": self.agent})
        call.text_pending += decoded
        if first or len(call.text_pending) >= 512:
            self.flush_file(call)

    def flush_file(self, call: FileCall) -> None:
        self.check()
        if call.reader.path and call.text_pending:
            self.emit("file_delta", {"path": call.reader.path, "text": call.text_pending})
            call.text_pending = ""

    def flush_text(self) -> None:
        self.check()
        if self.text_pending:
            self.emit("token", {"id": self.message_id, "text": self.text_pending})
            self.text_pending = ""

    def flush(self) -> None:
        for call in self.calls.values():
            self.flush_file(call)
        self.flush_text()


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
            runtime.check()
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
