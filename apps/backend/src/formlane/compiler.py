"""Bounded, cancellable bridge to the restricted virtual-source Node compiler."""

import json
import os
import re
import selectors
import signal
import subprocess
import time
from concurrent.futures import CancelledError

from .project import MAX_PREVIEW_BYTES, artifact_hash, source_hash, utf8_bytes, utf16_length

COMPILER_TIMEOUT_SECONDS = 30
MAX_COMPILER_OUTPUT = 4 * 1024 * 1024
# Two 512 KiB artifacts and a 1 MiB manifest can expand sixfold in JSON escapes.
MAX_EDITOR_COMPILER_OUTPUT = 16 * 1024 * 1024


def safe_environment() -> dict[str, str]:
    """Neither provider/DB credentials nor runtime injection flags reach children."""
    return {
        name: os.environ[name] for name in ("HOME", "PATH", "TMPDIR", "LANG") if name in os.environ
    }


def raise_if_cancelled(cancelled) -> None:
    if cancelled():
        raise CancelledError("Generation cancelled.")


def _process_snapshot() -> dict[int, tuple[int, int, str]]:
    result = subprocess.run(
        ["/bin/ps", "-eo", "pid=,ppid=,pgid=,lstart="],
        capture_output=True,
        text=True,
        timeout=1,
        check=True,
        env=safe_environment(),
    )
    snapshot = {}
    for line in result.stdout.splitlines():
        fields = line.split(None, 3)
        if len(fields) == 4:
            snapshot[int(fields[0])] = (int(fields[1]), int(fields[2]), fields[3])
    return snapshot


def _stop_group(process: subprocess.Popen) -> None:
    # Chromium deliberately detaches from the Playwright driver process group.
    # Capture those descendants before terminating the Python/Node group leader.
    descendants = {}
    try:
        snapshot = _process_snapshot()
        parents = {process.pid}
        while True:
            found = {
                pid
                for pid, (parent, group, _) in snapshot.items()
                if pid not in parents and (parent in parents or group == process.pid)
            }
            if not found:
                break
            parents.update(found)
        descendants = {pid: snapshot[pid] for pid in parents if pid in snapshot}
    except (OSError, subprocess.SubprocessError):
        # Still terminate the direct group if process inspection itself fails.
        pass
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    for pid, (_, group, _) in descendants.items():
        try:
            os.kill(pid, signal.SIGTERM)
            if group != os.getpgrp():
                os.killpg(group, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    if descendants:
        try:
            current = _process_snapshot()
        except (OSError, subprocess.SubprocessError):
            current = {}
        for pid, (_, _, started) in descendants.items():
            if pid not in current or current[pid][2] != started:
                continue
            group = current[pid][1]
            try:
                os.kill(pid, signal.SIGKILL)
                if group != os.getpgrp():
                    os.killpg(group, signal.SIGKILL)
            except ProcessLookupError:
                pass
    process.wait(timeout=1)
    for stream in (process.stdin, process.stdout, process.stderr):
        if stream is not None:
            stream.close()


def _exchange(
    process: subprocess.Popen,
    payload: bytes,
    cancelled,
    timeout_seconds: float | None = None,
    *,
    output_limit: int = MAX_COMPILER_OUTPUT,
) -> tuple[bytes, bytes]:
    deadline = time.monotonic() + (
        COMPILER_TIMEOUT_SECONDS if timeout_seconds is None else timeout_seconds
    )
    output, diagnostics = bytearray(), bytearray()
    sent = 0
    with selectors.DefaultSelector() as selector:
        for stream, event in (
            (process.stdin, selectors.EVENT_WRITE),
            (process.stdout, selectors.EVENT_READ),
            (process.stderr, selectors.EVENT_READ),
        ):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, event)
        while selector.get_map():
            raise_if_cancelled(cancelled)
            if time.monotonic() >= deadline:
                raise TimeoutError("Project compilation timed out.")
            for key, _ in selector.select(timeout=0.05):
                stream = key.fileobj
                if stream is process.stdin:
                    try:
                        sent += os.write(stream.fileno(), payload[sent : sent + 65536])
                    except BrokenPipeError:
                        sent = len(payload)
                    if sent == len(payload):
                        selector.unregister(stream)
                        stream.close()
                    continue
                chunk = os.read(stream.fileno(), 65536)
                if not chunk:
                    selector.unregister(stream)
                    continue
                target = output if stream is process.stdout else diagnostics
                target.extend(chunk)
                limit = output_limit if stream is process.stdout else 65536
                if len(target) > limit:
                    raise ValueError("Compiler response exceeded its output limit.")
        remaining = deadline - time.monotonic()
        while process.poll() is None:
            raise_if_cancelled(cancelled)
            if remaining <= 0:
                raise TimeoutError("Project compilation timed out.")
            try:
                process.wait(timeout=min(0.05, remaining))
            except subprocess.TimeoutExpired:
                pass
            remaining = deadline - time.monotonic()
    return bytes(output), bytes(diagnostics)


def compile_project(source: dict, settings, cancelled) -> dict:
    return _compile(source, settings, cancelled, editor=False)


def compile_editor_project(source: dict, settings, cancelled) -> dict:
    """Reproducible private attribution for the same canonical immutable source."""
    return _compile(source, settings, cancelled, editor=True)


def _compile(source: dict, settings, cancelled, *, editor: bool) -> dict:
    raise_if_cancelled(cancelled)
    expected_hash = source_hash(source)
    command = settings.compiler_command
    if isinstance(command, str):
        try:
            command = json.loads(command)
        except ValueError:
            raise ValueError("COMPILER_COMMAND must be a JSON argv array.") from None
    if (
        not isinstance(command, list)
        or not command
        or any(not isinstance(item, str) or not item or "\0" in item for item in command)
    ):
        raise ValueError("COMPILER_COMMAND must be a nonempty JSON argv array.")
    request = {"mode": "editor", "source": source} if editor else source
    payload = json.dumps(request, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    raise_if_cancelled(cancelled)
    process = subprocess.Popen(
        command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=safe_environment(),
        start_new_session=True,
    )
    try:
        stdout, stderr = _exchange(
            process,
            payload,
            cancelled,
            output_limit=MAX_EDITOR_COMPILER_OUTPUT if editor else MAX_COMPILER_OUTPUT,
        )
        raise_if_cancelled(cancelled)
        if process.returncode:
            raise ValueError(
                "Project compilation failed: " + stderr.decode("utf-8", errors="replace")[:4000]
            )
        try:
            result = json.loads(stdout)
        except (ValueError, UnicodeError):
            raise ValueError("Compiler returned an invalid JSON response.") from None
        if (
            not isinstance(result, dict)
            or set(result)
            != (
                {"html", "sourceHash", "editorHtml", "manifest", "diagnostics"}
                if editor
                else {"html", "sourceHash"}
            )
            or not isinstance(result["html"], str)
        ):
            raise ValueError("Compiler returned an invalid result.")
        if result["sourceHash"] != expected_hash:
            raise ValueError("Compiler source hash does not match the current source.")
        if len(utf8_bytes(result["html"])) > MAX_PREVIEW_BYTES:
            raise ValueError("The compiled preview exceeds the 512 KiB limit.")
        if editor:
            _validate_editor_result(result, source)
        return result
    finally:
        _stop_group(process)


def _validate_editor_result(result: dict, source: dict) -> None:
    from .selection import SourceManifest

    html = result["editorHtml"]
    if not isinstance(html, str) or len(utf8_bytes(html)) > MAX_PREVIEW_BYTES:
        raise ValueError("The editor preview exceeds the 512 KiB limit.")
    manifest = SourceManifest.model_validate(result["manifest"])
    if (
        manifest.sourceHash != result["sourceHash"]
        or manifest.canonicalArtifactHash != artifact_hash(result["html"])
        or manifest.editorArtifactHash != artifact_hash(html)
    ):
        raise ValueError("Compiler manifest hash does not match its artifacts.")
    if len(json.dumps(result["manifest"], ensure_ascii=False).encode("utf-8")) > 1024 * 1024:
        raise ValueError("Compiler manifest exceeds its output limit.")
    source_lines: dict[str, list[str]] = {}
    for location in manifest.entries.values():
        original = source["files"].get(location.path)
        if original is None:
            raise ValueError("Compiler source location is outside the source.")
        lines = source_lines.get(location.path)
        if lines is None:
            # HTML normalizes CR/CRLF; TypeScript also recognizes Unicode line separators.
            separators = (
                r"\r\n|[\r\n]" if location.path == "index.html" else r"\r\n|[\r\n\u2028\u2029]"
            )
            lines = source_lines[location.path] = re.split(separators, original)
        if (
            location.endLine > len(lines)
            or (location.startLine, location.startColumn) >= (location.endLine, location.endColumn)
            or location.startColumn > utf16_length(lines[location.startLine - 1]) + 1
            or location.endColumn > utf16_length(lines[location.endLine - 1]) + 1
        ):
            raise ValueError("Compiler source location is outside the source.")
    diagnostics = result["diagnostics"]
    if not isinstance(diagnostics, list) or len(diagnostics) > 200:
        raise ValueError("Compiler diagnostics exceed their output limit.")
    for item in diagnostics:
        if (
            not isinstance(item, dict)
            or set(item) - {"code", "path", "startLine", "startColumn"}
            or item.get("code") not in {"reserved-marker", "jsx-spread", "instrumentation-limit"}
            or ("path" in item and item["path"] not in source["files"])
            or any(
                type(item[key]) is not int or item[key] < 1
                for key in ("startLine", "startColumn")
                if key in item
            )
        ):
            raise ValueError("Compiler returned invalid diagnostics.")
