"""Behavioral recordings through execute_harness, native Flow and native CrewAI.

Only HTTP, compiler/browser processes, clock/identity and the durable journal are
controlled. No stage, workspace, model call, executor or tool is replaced.

The twelve golden recordings were captured from baseline af5e54f. Their bytes
remain immutable. flow-v3 adds native images and a visual acceptance gate, so
these scenarios now assert explicit semantic contracts. Historical provenance
is still checked; no recording is rewritten to bless changed behavior.
inputs.record contains controlled external inputs, not claimed live-provider
evidence. Golden outputs are always observed, never authored.
"""

from __future__ import annotations

import copy
import base64
import io
import hashlib
import json
import random
import sys
import time
import uuid
from concurrent.futures import CancelledError
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from PIL import Image

from formlane import compiler, validator
from formlane.delivery import execute_harness
from formlane.project import artifact_hash, create_source, source_hash

FIXTURES = Path(__file__).parent / "fixtures" / "flow_equivalence"
INPUTS = json.loads((FIXTURES / "inputs.record").read_text())
BASELINE = "af5e54f"
SUPERSEDED_SCENARIOS = {
    "verify_repair", "verify_repair_limit", "review_repair", "review_repair_limit",
}
COMPATIBLE_SCENARIOS = [name for name in INPUTS["scenarios"] if name not in SUPERSEDED_SCENARIOS]


def clone(value):
    """Match the JSON persistence boundary, including tuples becoming arrays."""
    return json.loads(json.dumps(value, ensure_ascii=False, allow_nan=False))


def call(name, arguments=None):
    return {"name": name, "arguments": arguments or {}}


def turn(*calls, text=""):
    return {"calls": list(calls), "text": text}


def scenario_tape(name):
    """Expand fixed external response records; never inspect live workspace state."""
    checks = copy.deepcopy(INPUTS["checks"])
    plan_checks = copy.deepcopy(checks)
    if name == "check_defect":
        plan_checks[1]["assertions"][1]["expected"] = "2"
    plan = {
        "brief": "A counter showing the current date.",
        "criteria": [
            {"id": "C1", "outcome": "Show today's date at either pinned clock."},
            {"id": "C2", "outcome": "Add increases the counter by one."},
        ],
        "assumptions": ["Counter state lasts for the page session."],
        "gaps": [],
        "template": "vanilla",
        "architecture": "Vanilla JavaScript, semantic HTML and the shared stylesheet.",
        "checks": plan_checks,
    }
    responses = []
    browser = []
    follow_up = name in {"quick_edit", "plan_follow_up"}
    if follow_up:
        responses.append(
            turn(call("choose_route", {
                "route": "quick_edit" if name == "quick_edit" else "plan",
                "reason": "Apply the requested counter update.",
            }))
        )
    if name != "quick_edit":
        responses.append(turn(call("submit_plan", plan), text="The checks bind the plan."))

    def implement(revision=0, validate=True, defect=False, budget=False):
        source = INPUTS["source"] + (f"// Repair {revision}.\n" if revision else "")
        # Multiple native calls in one provider response exercise ordered mutation.
        responses.append(turn(
            call("write_file", {"path": "src/main.js", "content": source}),
            call("build_project"),
            text="Writing the counter and compiling this source.",
        ))
        if budget:
            responses.extend(
                turn(call("inspect_preview", {"selector": ("main", "#increment")[index % 2]}))
                for index in range(13)
            )
        if validate:
            responses.append(turn(call("validate_preview")))
            browser.append("defect" if defect else "pass")
            if budget:
                # Native CrewAI stops five identical consecutive calls before
                # the application's budget. Observe workspace between validations
                # so the ninth call reaches the real per-stage budget instead.
                responses.extend(
                    turn(call("read_workspace"), call("validate_preview")) for _ in range(8)
                )
                browser.extend(["pass"] * 7)
            responses.append(turn(call("submit_candidate", {
                "summary": f"Counter candidate {revision}.",
                "check_defects": ["increment tomorrow"] if defect else [],
            })))
        else:
            # Native final text is legal. The Flow must obtain missing evidence.
            responses.append(turn(text="The build is ready for deterministic verification."))

    def review(accepted=True, correct_checks=False, budget=False):
        responses.append(turn(call("read_review_files", {
            "paths": ["index.html", "package.json", "src/main.js", "src/styles.css"],
        })))
        responses.append(turn(call("inspect_preview", {"viewport": {"width": 1280, "height": 720}})))
        responses.append(turn(call("inspect_preview", {"viewport": {"width": 375, "height": 812}})))
        if correct_checks or budget:
            responses.append(turn(call("set_acceptance_checks", {"checks": checks})))
        if budget:
            responses.extend(
                turn(call("set_acceptance_checks", {"checks": checks})) for _ in range(2)
            )
            responses.extend(
                turn(call("inspect_preview", {"selector": ("main", "#increment")[index % 2]}))
                for index in range(7)
            )
        responses.append(turn(call("validate_preview")))
        browser.append("pass")
        if budget:
            responses.extend(turn(call("validate_preview")) for _ in range(3))
            browser.extend(["pass"] * 2)
        responses.append(turn(call("record_review", {
            "accepted": accepted,
            "findings": "Accepted the current counter." if accepted else "Repair the counter label.",
        })))

    if name in {"missing_key", "cancellation"}:
        if name == "missing_key":
            return [], []
        # Cancellation interrupts streaming before the first source mutation.
        responses.append(turn(call("write_file", {
            "path": "src/main.js", "content": INPUTS["source"],
        })))
        return responses, []
    if name == "check_defect":
        implement(defect=True)
        browser.append("defect")  # deterministic verify routes the named dispute
        review(correct_checks=True)
        browser.append("pass")  # corrected checks restore implementation evidence
    else:
        implement(budget=name == "budget_exhaustion")
        review(budget=name == "budget_exhaustion")
    return responses, browser


class ProviderRecording:
    """Intercept HTTP after OpenAI serializes requests; decode SSE in the real SDK."""

    def __init__(self, responses):
        self.responses = responses
        self.index = 0
        self.requests = []

    def send(self, request, **kwargs):
        assert request.method == "POST"
        assert str(request.url) == "https://flow-equivalence.invalid/v1/chat/completions"
        body = json.loads(request.content)
        assert body["stream"] is True
        assert body["parallel_tool_calls"] is False
        assert self.index < len(self.responses), "Unexpected extra native provider request"
        record = clone(self.responses[self.index])
        image_ids = []
        baseline_ids = []
        for message in body["messages"]:
            if message["role"] == "user" and isinstance(message.get("content"), list):
                for part in message["content"]:
                    if part["type"] == "text":
                        metadata = json.loads(part["text"])
                        if metadata.get("target") == "current":
                            image_ids.append(metadata["id"])
                        elif metadata.get("target") == "baseline" and metadata.get("stage"):
                            baseline_ids.append(metadata["id"])
        for invocation in record["calls"]:
            if (invocation["name"] == "record_review" and invocation["arguments"]["accepted"]
                    and "visual_evidence_ids" not in invocation["arguments"]):
                invocation["arguments"]["visual_evidence_ids"] = image_ids
            elif invocation["arguments"].get("visual_evidence_ids") == ["$baseline"]:
                invocation["arguments"]["visual_evidence_ids"] = baseline_ids
        response_index = self.index
        self.index += 1
        # Prompt prose is intentionally outside this behavioral seam. Preserve
        # the complete tool result payloads (including budget denials), role tool
        # sets, reasoning and native request policy without matching prompt text.
        self.requests.append({
            "model": body["model"],
            "reasoning_effort": body.get("reasoning_effort"),
            "stream": body["stream"],
            "parallel_tool_calls": body["parallel_tool_calls"],
            "tools": [item["function"]["name"] for item in body.get("tools", [])],
            "tool_results": [item for item in body["messages"] if item["role"] == "tool"],
            "native_image_count": sum(part["type"] == "image_url" for message in body["messages"]
                                      if isinstance(message.get("content"), list) for part in message["content"]),
        })
        chunks = []

        def chunk(delta, finish=None):
            chunks.append("data: " + json.dumps({
                "id": f"chatcmpl-recording-{response_index}",
                "object": "chat.completion.chunk",
                "created": int(INPUTS["epoch"]),
                "model": "gpt-5.4",
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            }, ensure_ascii=True) + "\n\n")

        chunk({"role": "assistant"})
        if record["text"]:
            chunk({"content": record["text"]})
        for index, invocation in enumerate(record["calls"]):
            arguments = json.dumps(invocation["arguments"], ensure_ascii=True)
            # Fixed character boundaries exercise incremental JSON escaping and
            # file draft delivery; no scheduler-dependent streaming segmentation.
            for offset in range(0, len(arguments), 19):
                first = offset == 0
                function = {"arguments": arguments[offset:offset + 19]}
                native_call = {"index": index, "function": function}
                if first:
                    function["name"] = invocation["name"]
                    native_call.update(
                        id=f"call-{response_index}-{index}", type="function"
                    )
                chunk({"tool_calls": [native_call]})
        chunk({}, "tool_calls" if record["calls"] else "stop")
        chunks.append("data: [DONE]\n\n")
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream", "x-request-id": "recorded-request"},
            content="".join(chunks).encode(),
            request=request,
        )


class ExternalOutcomes:
    """Recorded results at the compiler and isolated browser process boundaries."""

    def __init__(self, browser):
        self.browser = browser
        self.index = 0
        self.calls = []

    def compile(self, source, settings, cancelled):
        assert not cancelled()
        result = {"html": INPUTS["html"], "sourceHash": source_hash(source)}
        self.calls.append({"kind": "compiler", "source": clone(source), "result": result})
        return clone(result)

    def browser_process(self, payload, cancelled, timeout):
        assert not cancelled()
        if payload.get("mode") == "inspect":
            result = clone(INPUTS["browser"]["inspect"])
            viewport = payload["request"].get("viewport") or {"width": 1280, "height": 720}
            pixels = io.BytesIO()
            Image.new("RGB", (viewport["width"], viewport["height"]), "white").save(pixels, format="PNG")
            result.update(
                artifactHash=artifact_hash(payload["html"]),
                resolution={"status": "resolved", "matches": 1},
                image={"provenance": "server-reconstructed", "mimeType": "image/png",
                       "base64": base64.b64encode(pixels.getvalue()).decode("ascii"), **viewport},
            )
        else:
            assert self.index < len(self.browser), "Unexpected extra browser validation"
            outcome = self.browser[self.index]
            self.index += 1
            result = clone(INPUTS["browser"][outcome])
            result["artifactHash"] = artifact_hash(payload["html"])
            assert [item["name"] for item in result["checks"]] == [
                item["name"] for item in payload["checks"]
            ]
        self.calls.append({
            "kind": "browser", "payload": clone(payload), "timeout": timeout, "result": result,
        })
        return clone(result)


class Journal:
    """Durable seam: JSON-committed values survive a new harness invocation.

    This is not a DBOS recovery test. The installed-library and PostgreSQL suites
    own that contract. Here cache hits must bypass provider/tool side effects,
    while the Flow still emits its full replay observation sequence.
    """

    def __init__(self, committed=None, interrupt_after=None):
        self.committed = clone(committed or {})
        self.interrupt_after = interrupt_after
        self.steps = []
        self.scopes = []
        self.active = None

    @contextmanager
    def events(self, name):
        parent = self.active
        self.active = name
        self.scopes.append({"enter": name})
        try:
            yield
        finally:
            self.scopes.append({"exit": name})
            self.active = parent

    def run(self, name, function):
        cached = name in self.committed
        self.steps.append({"name": name, "cached": cached})
        if not cached:
            with self.events(name):
                self.committed[name] = clone(function())
        if name == self.interrupt_after:
            self.interrupt_after = None
            raise CancelledError("Recorded interruption after a committed operation.")
        return clone(self.committed[name])


def freeze_inputs(monkeypatch):
    monkeypatch.setenv("CREWAI_DISABLE_TELEMETRY", "true")
    monkeypatch.setenv("OTEL_SDK_DISABLED", "true")
    monkeypatch.setenv("CREWAI_TRACING_ENABLED", "false")
    monkeypatch.setenv("TZ", "UTC")
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        monkeypatch.delenv(name, raising=False)
    # Only wall time is frozen. Monotonic clocks must keep advancing so a broken
    # native executor cannot silently disable timeouts in the test process.
    monkeypatch.setattr(time, "time", lambda: INPUTS["epoch"])
    original_uuid4 = uuid.uuid4
    sequence = iter(range(1, 100_000))

    def fixed_uuid4():
        return uuid.UUID(int=next(sequence), version=4)

    # Imported aliases used by CrewAI Flow IDs receive the same deterministic
    # source. Public message IDs remain the production runId/path UUID5 values.
    for module_name, module in list(sys.modules.items()):
        if module and module_name.startswith(("formlane", "crewai")):
            for attribute, value in list(vars(module).items()):
                if value is original_uuid4:
                    monkeypatch.setattr(module, attribute, fixed_uuid4)
    monkeypatch.setattr(uuid, "uuid4", fixed_uuid4)


def assert_scenario(name, observed, provider, external, context):
    """Independent invariants ensure each recording exercises the intended path."""
    last = observed["attempts"][-1]
    assert provider.index == len(provider.responses), "Unused provider response records"
    assert external.index == len(external.browser), "Unused browser outcome records"
    failures = {"missing_key": "provider", "cancellation": "cancelled"}
    if name in failures:
        assert last["failure"] == {"code": failures[name]}
        assert last["result"] is None
    else:
        assert last["failure"] is None
        assert last["result"]["source"]["files"]["src/main.js"].startswith(INPUTS["source"])
        assert last["result"]["html"] == INPUTS["html"]
        assert [check["name"] for check in last["result"]["checks"]] == [
            "smoke: 375px render without runtime errors", "calendar today", "increment tomorrow",
        ]
        assert [check["seed"] for check in last["result"]["checks"][1:]] == [73, 917]
        assert [check["clock"]["now"] for check in last["result"]["checks"][1:]] == [
            "2026-03-22T00:00:00.000Z", "2026-03-23T00:00:00.000Z",
        ]
    steps = [step["name"] for step in last["steps"]]
    if name == "quick_edit":
        assert "flow-v1/quick-edit/llm-0" in steps
        assert not any(step.startswith("flow-v1/plan-") for step in steps)
    if name == "plan_follow_up":
        assert "flow-v1/route/llm-0" in steps
        assert "flow-v1/plan-0/llm-0" in steps
    if name == "check_defect":
        assert "flow-v1/revalidate-0/tool-0-validate_preview" in steps
        assert not any("/repair-" in step for step in steps)
    if name == "budget_exhaustion":
        denied = {
            json.loads(item["content"])["error"]
            for request in provider.requests
            for item in request["tool_results"]
            if "budget of" in item["content"]
        }
        assert len(denied) == 5, denied
    if name == "missing_key":
        assert not provider.requests and not external.calls and not steps
        assert last["events"] == []
    if name == "cancellation":
        assert "flow-v1/plan-0/tool-0-submit_plan" in last["committed"]
        assert "flow-v1/build/llm-0" in steps
        assert any(
            event["type"] == "file_delta" and event["scope"] == "flow-v1/build/llm-0"
            for event in last["events"]
        )
        assert not any(event["type"] == "file_saved" for event in last["events"])
        assert not external.calls
    if name == "resumed_committed_operations":
        first = observed["attempts"][0]
        assert first["failure"] == {"code": "cancelled"}
        assert first["committed"]
        assert all(step["cached"] for step in last["steps"][:len(first["steps"])])
        assert sum(item["kind"] == "compiler" for item in external.calls) == 1
        assert last["committed"][:len(first["committed"])] == first["committed"]
    assert context == observed["context"], "The immutable input/baseline must not change"


def observe_scenario(name, monkeypatch, selection=None, replay=False, stale_inspection=False):
    """Run recorded external inputs through the native harness and retain every output."""
    random_state = random.getstate()
    random.seed(73)
    freeze_inputs(monkeypatch)
    responses, browser = scenario_tape(name)
    if selection:
        responses.insert(1, turn(call("read_selection")))
        for response in responses:
            for invocation in response["calls"]:
                if invocation["name"] == "inspect_preview":
                    invocation["arguments"]["selection_id"] = selection["selectionId"]
        # A client image is available to the real native model, but cannot approve the build.
        responses.insert(-1, turn(call("record_review", {
            "accepted": True, "findings": "Approve using the owner's image",
            "visual_evidence_ids": [selection["selectionId"]],
        })))
        responses.insert(-1, turn(call("inspect_preview", {"target": "baseline",
                                  "selection_id": selection["selectionId"],
                                  "viewport": {"width": 1280, "height": 720}})))
        responses.insert(-1, turn(call("record_review", {
            "accepted": True, "findings": "Approve using the baseline screenshot",
            "visual_evidence_ids": ["$baseline"],
        })))
    if stale_inspection:
        index = next(index for index, response in enumerate(responses)
                     if any(item["name"] == "inspect_preview" for item in response["calls"]))
        responses.insert(index, clone(responses[index]))
    provider = ProviderRecording(responses)
    external = ExternalOutcomes(browser)
    monkeypatch.setattr(httpx.Client, "send", lambda client, request, **kw: provider.send(request, **kw))
    # Imports may already exist through conftest/worker. Replace aliases of this
    # one external compiler boundary, wherever the public runtime imported it.
    original_compile = compiler.compile_project
    for module_name, module in list(sys.modules.items()):
        if module and module_name.startswith("formlane"):
            for attribute, value in list(vars(module).items()):
                if value is original_compile:
                    monkeypatch.setattr(module, attribute, external.compile)
    def browser_process(payload, cancelled, timeout):
        nonlocal stale_inspection
        result = external.browser_process(payload, cancelled, timeout)
        if stale_inspection and payload.get("mode") == "inspect":
            stale_inspection = False
            result["artifactHash"] = artifact_hash("previous build")
        return result

    monkeypatch.setattr(validator, "_subprocess", browser_process)
    settings = SimpleNamespace(
        openai_api_key="" if name == "missing_key" else "recorded-provider-key",
        endpoint="https://flow-equivalence.invalid/v1",
        model="gpt-5.4",
        browser_executable=None,
    )
    context = {
        "runId": INPUTS["runId"], "request": INPUTS["request"],
        "idea": "Build a dated counter.", "previousSource": None, "previousChecks": [],
    }
    if name in {"quick_edit", "plan_follow_up"}:
        context["previousSource"] = create_source("vanilla")
        context["previousChecks"] = clone(INPUTS["checks"])
    if selection:
        context["selection"] = clone(selection)
    observed = {"context": clone(context), "attempts": []}
    committed = None
    attempt_count = 2 if replay or name == "resumed_committed_operations" else 1
    try:
        for attempt in range(attempt_count):
            journal = Journal(
                committed,
                interrupt_after="flow-v1/candidate/000001" if attempt_count == 2 and not attempt else None,
            )
            events = []
            cancelled = False

            def emit(kind, data):
                nonlocal cancelled
                events.append({"scope": journal.active, "type": kind, "data": clone(data)})
                if name == "cancellation" and kind == "file_delta":
                    cancelled = True

            result = failure = None
            try:
                result = execute_harness(settings, context, journal, emit, lambda: cancelled)
            except BaseException as error:
                cause = getattr(error, "cause", error)
                if isinstance(cause, CancelledError):
                    failure = {"code": "cancelled"}
                elif getattr(cause, "code", None) in {"provider", "validation", "step_limit", "internal"}:
                    failure = {"code": cause.code}
                else:
                    raise
            committed = clone(journal.committed)
            observed["attempts"].append({
                "events": events, "steps": journal.steps, "scopes": journal.scopes,
                "committed": list(committed), "result": clone(result), "failure": failure,
                "providerRequestsConsumed": provider.index,
                "externalOutcomesConsumed": len(external.calls),
            })
        observed["provider_requests"] = provider.requests
        observed["external_outcomes"] = external.calls
        assert_scenario(name, observed, provider, external, context)
        return observed
    finally:
        random.setstate(random_state)


@pytest.mark.parametrize("name", COMPATIBLE_SCENARIOS)
def test_flow_equivalence(name, monkeypatch):
    assert len(COMPATIBLE_SCENARIOS) == 8
    golden = FIXTURES / f"{name}.json"
    assert golden.exists(), f"Missing frozen baseline recording: {golden.name}"
    observed = observe_scenario(name, monkeypatch)
    expected = json.loads(golden.read_text())
    assert expected["provenance"]["baseline"] == BASELINE
    assert expected["provenance"]["inputSha256"] == hashlib.sha256(
        (FIXTURES / "inputs.record").read_bytes()
    ).hexdigest()
    # Historical bytes are retained, but their accepted-without-images result is
    # no longer an executable success contract. Assert the new gate end to end.
    if observed["attempts"][-1]["result"]:
        inspection = [item for item in observed["external_outcomes"]
                      if item["kind"] == "browser" and item["payload"].get("mode") == "inspect"]
        assert {375, 1280} <= {item["result"]["image"]["width"] for item in inspection}
        public = json.dumps(observed["attempts"][-1]["events"])
        assert '"base64"' not in public and "data:image/" not in public
        assert any(request["native_image_count"] >= 2 for request in observed["provider_requests"])
