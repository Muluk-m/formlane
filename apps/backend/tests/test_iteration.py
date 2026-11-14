"""Native semantic contracts for iteration and flow-v3 visual acceptance.

Historical recordings remain immutable. These tests use HTTP/SSE and process
boundaries; no stage, Runtime operation, executor or completion gate is replaced.
"""

from __future__ import annotations

import json
import random
import sys
from concurrent.futures import CancelledError
from types import SimpleNamespace

import httpx
import pytest
from test_flow_equivalence import (
    INPUTS,
    ExternalOutcomes,
    Journal,
    ProviderRecording,
    call,
    clone,
    freeze_inputs,
    scenario_tape,
    turn,
)

from formlane import compiler, validator
from formlane.delivery import execute_harness
from formlane.delivery.workspace import completion_status


class IterationTape:
    def __init__(self, check_defect=False):
        baseline, _ = scenario_tape("check_defect" if check_defect else "initial_build")
        self.responses = [baseline[0]]
        self.browser = []

    def implement(self, revision=0, validate=True, defect=False):
        source = INPUTS["source"] + (f"// Iteration {revision}.\n" if revision else "")
        self.responses.append(turn(
            call("write_file", {"path": "src/main.js", "content": source}),
            call("build_project"),
        ))
        if validate:
            self.responses.append(turn(call("validate_preview")))
            self.browser.append("defect" if defect else "pass")
            self.responses.append(turn(call("submit_candidate", {
                "summary": f"Candidate {revision}.",
                "check_defects": ["increment tomorrow"] if defect else [],
            })))
        else:
            self.responses.append(turn(text="The build needs independent assessment."))

    def review(self, accepted=True, outcome="pass", correct_checks=False, findings=None):
        self.responses.append(turn(call("read_review_files", {
            "paths": ["index.html", "package.json", "src/main.js", "src/styles.css"],
        })))
        if correct_checks:
            self.responses.append(turn(call("set_acceptance_checks", {
                "checks": clone(INPUTS["checks"]),
            })))
        self.responses.append(turn(call("inspect_preview", {"viewport": {"width": 1280, "height": 720}})))
        self.responses.append(turn(call("inspect_preview", {"viewport": {"width": 375, "height": 812}})))
        self.responses.append(turn(call("validate_preview")))
        self.browser.append(outcome)
        self.responses.append(turn(call("record_review", {
            "accepted": accepted,
            "findings": findings or ("Accepted current evidence." if accepted else "Repair counter."),
        })))

    def coordinate(self, next_step, instructions):
        self.responses.append(turn(call("read_workspace")))
        self.responses.append(turn(call("schedule_iteration", {
            "next_step": next_step, "instructions": instructions,
        })))


class IterationProvider(ProviderRecording):
    def __init__(self, responses):
        super().__init__(responses)
        self.messages = []

    def send(self, request, **kwargs):
        self.messages.append(json.loads(request.content)["messages"])
        return super().send(request, **kwargs)


def run_iteration(monkeypatch, tape, interrupt_after=None):
    """Replay committed operations with fresh harness state and the remaining HTTP tape."""
    random_state = random.getstate()
    random.seed(73)
    freeze_inputs(monkeypatch)
    provider = IterationProvider(tape.responses)
    external = ExternalOutcomes(tape.browser)
    monkeypatch.setattr(httpx.Client, "send", lambda client, request, **kw: provider.send(request, **kw))
    original_compile = compiler.compile_project
    for module_name, module in list(sys.modules.items()):
        if module and module_name.startswith("formlane"):
            for attribute, value in list(vars(module).items()):
                if value is original_compile:
                    monkeypatch.setattr(module, attribute, external.compile)
    monkeypatch.setattr(validator, "_subprocess", external.browser_process)
    settings = SimpleNamespace(
        openai_api_key="recorded-provider-key",
        endpoint="https://flow-equivalence.invalid/v1",
        model="gpt-5.4",
        browser_executable=None,
    )
    context = {
        "runId": INPUTS["runId"], "request": INPUTS["request"],
        "idea": "Build a dated counter.", "previousSource": None, "previousChecks": [],
    }
    original_context = clone(context)
    attempts = []
    committed = None
    try:
        for attempt in range(2 if interrupt_after else 1):
            journal = Journal(committed, interrupt_after if attempt == 0 else None)
            events = []

            def emit(kind, data):
                events.append({"scope": journal.active, "type": kind, "data": clone(data)})

            result = None
            cancelled = False
            try:
                result = execute_harness(settings, context, journal, emit, lambda: False)
            except BaseException as error:
                if not isinstance(getattr(error, "cause", error), CancelledError):
                    raise
                cancelled = True
            committed = clone(journal.committed)
            attempts.append({
                "result": result, "cancelled": cancelled, "events": events,
                "steps": journal.steps, "committed": committed,
                "provider_count": provider.index, "external_count": len(external.calls),
            })
        assert provider.index == len(tape.responses), "Unused iteration HTTP responses"
        assert external.index == len(tape.browser), "Unused iteration browser outcomes"
        assert not attempts[-1]["cancelled"]
        assert attempts[-1]["result"]["html"] == INPUTS["html"]
        assert context == original_context
        final_reviews = [
            saved["workspace"] for key, saved in committed.items()
            if key.endswith("-record_review")
        ]
        # Deterministic Alex restoration can follow David's accepted verdict.
        final_workspace = next(
            saved["workspace"] for saved in reversed(list(committed.values()))
            if isinstance(saved, dict) and "workspace" in saved
        )
        assert final_reviews[-1]["review"]["accepted"]
        assert completion_status(final_workspace)["ready"]
        return attempts, provider, external
    finally:
        random.setstate(random_state)


def repair_tape(rounds, failed_verification=False):
    tape = IterationTape()
    tape.implement(validate=not failed_verification)
    if failed_verification:
        tape.browser.append("fail")  # One deterministic verification, then David.
    for round in range(rounds):
        tape.review(accepted=False, outcome="fail" if failed_verification else "pass")
        if failed_verification:
            tape.browser.append("fail")  # Missing Alex evidence restoration still fails.
        tape.coordinate("repair", f"Repair counter iteration {round + 1} for the original request.")
        tape.implement(round + 1, validate=not failed_verification)
        tape.browser.append(
            "fail" if failed_verification and round + 1 < rounds else "pass"
        )  # review-verify obtains fresh implementation evidence.
    tape.review()
    return tape


@pytest.mark.parametrize(
    ("rounds", "failed_verification"),
    [(1, True), (4, True), (4, False)],
    ids=["verify_repair", "verify_repair_limit", "review_repair_limit"],
)
def test_mike_arranges_repairs_until_david_accepts(monkeypatch, rounds, failed_verification):
    attempts, provider, external = run_iteration(
        monkeypatch, repair_tape(rounds, failed_verification),
    )
    committed = attempts[-1]["committed"]
    steps = list(committed)
    assert not any(key.startswith("flow-v1/repair-") for key in steps)
    assert sum("-schedule_iteration" in key for key in steps) == rounds
    assert sum(item["kind"] == "compiler" for item in external.calls) == rounds + 1
    for round in range(rounds):
        decision = f"flow-v1/iteration-{round}-0/tool-1-schedule_iteration"
        repair = f"flow-v1/review-repair-{round}/tool-0-write_file"
        review = f"flow-v1/review-{round + 1}/llm-0"
        assert steps.index(decision) < steps.index(repair) < steps.index(review)
        assert committed[decision]["output"]["stage"] == f"flow-v1/iteration-{round}-0"
    assert attempts[-1]["result"]["source"]["files"]["src/main.js"].endswith(
        f"// Iteration {rounds}.\n"
    )
    coordinator_requests = [
        request for request in provider.requests if "schedule_iteration" in request["tools"]
    ]
    assert coordinator_requests
    assert all(set(request["tools"]) == {"read_workspace", "schedule_iteration"}
               for request in coordinator_requests)
    assert all(request["reasoning_effort"] == "medium" for request in coordinator_requests)
    for request, messages in zip(provider.requests, provider.messages):
        if "schedule_iteration" in request["tools"]:
            prompt = json.dumps(messages)
            assert INPUTS["request"] in prompt
            assert "Repair counter." in prompt
    mike_messages = [
        event["data"]["content"] for event in attempts[-1]["events"]
        if event["type"] == "message_done" and event["data"].get("agent") == "mike"
    ]
    for round in range(rounds):
        assert any(f"Repair counter iteration {round + 1}" in message for message in mike_messages)


def test_review_repair_corrects_qa_checks_without_source_repair(monkeypatch):
    tape = IterationTape(check_defect=True)
    tape.implement(defect=True)
    tape.browser.append("defect")  # Initial deterministic verification.
    tape.review(False, "defect", findings="The increment check expects two instead of one.")
    tape.browser.append("defect")  # Alex evidence cannot pass the incorrect check.
    instruction = "Correct increment tomorrow to expect one; preserve the implementation."
    tape.coordinate("review", instruction)
    tape.review(correct_checks=True)
    tape.browser.append("pass")  # Restore Alex's evidence against David's corrected checks.
    attempts, provider, external = run_iteration(monkeypatch, tape)
    committed = attempts[-1]["committed"]
    decision = committed["flow-v1/iteration-0-0/tool-1-schedule_iteration"]
    final = attempts[-1]["result"]
    assert final["source"] == decision["workspace"]["source"]
    assert final["source"]["files"]["src/main.js"] == INPUTS["source"]
    assert sum(item["kind"] == "compiler" for item in external.calls) == 1
    assert not any("review-repair-" in key for key in committed)
    assert "flow-v1/revalidate-1/tool-0-validate_preview" in committed
    assert any(
        instruction in json.dumps(messages)
        for request, messages in zip(provider.requests, provider.messages)
        if "record_review" in request["tools"]
    )
    before = committed["flow-v1/iteration-0-0/tool-0-read_workspace"]["workspace"]
    assert decision["workspace"] == {**before, "iteration": decision["output"]}


def test_stale_accepted_verdict_and_iteration_decision_cannot_advance_a_new_stage(monkeypatch):
    tape = IterationTape()
    tape.implement(validate=False)
    tape.browser.append("fail")
    tape.review()  # David accepts, but Alex's missing evidence still fails.
    tape.browser.append("fail")
    tape.coordinate("review", "Inspect the current evidence again.")
    tape.responses.append(turn(text="I have no new verdict yet."))
    tape.browser.append("pass")  # Alex now passes; the OLD accepted review must not deliver.
    tape.responses.append(turn(text="I have not chosen the next step yet."))
    tape.coordinate("review", "Obtain a fresh independent acceptance verdict.")
    tape.review()
    attempts, provider, _ = run_iteration(monkeypatch, tape)
    committed = attempts[-1]["committed"]
    assert "flow-v1/iteration-1-0/llm-0" in committed
    assert "flow-v1/iteration-1-1/tool-1-schedule_iteration" in committed
    assert "flow-v1/review-2/tool-4-record_review" in committed
    decision = committed["flow-v1/iteration-1-1/tool-1-schedule_iteration"]["output"]
    assert decision["stage"] == "flow-v1/iteration-1-1"
    assert not any("review-repair-" in key for key in committed)
    # Read-only stages did not manufacture source changes or a new verdict.
    assert attempts[-1]["result"]["source"]["files"]["src/main.js"] == INPUTS["source"]
    assert sum("schedule_iteration" in request["tools"] for request in provider.requests) == 5


@pytest.mark.parametrize("interrupt_after", [
    "flow-v1/iteration-0-0/tool-1-schedule_iteration",
    "flow-v1/review-repair-0/tool-0-write_file",
    "flow-v1/review-repair-0/tool-1-build_project",
])
def test_cancelled_iteration_replays_without_repeating_committed_effects(monkeypatch, interrupt_after):
    tape = repair_tape(2)
    attempts, provider, external = run_iteration(monkeypatch, tape, interrupt_after)
    first, resumed = attempts
    assert first["cancelled"] and first["result"] is None
    assert interrupt_after in first["committed"]
    assert first["steps"][-1]["name"] == interrupt_after
    replayed = resumed["steps"][:len(first["steps"])]
    assert [step["name"] for step in replayed] == [step["name"] for step in first["steps"]]
    assert all(step["cached"] for step in replayed)
    for key, value in first["committed"].items():
        assert resumed["committed"][key] == value
    assert provider.index == len(tape.responses)
    compilations = [item for item in external.calls if item["kind"] == "compiler"]
    assert len(compilations) == 3
    assert len({item["result"]["sourceHash"] for item in compilations}) == 3
    # Replayed public observations are expected; actual tool executions must be unique.
    executed_tools = [
        event["data"]["id"] for attempt in attempts for event in attempt["events"]
        if event["type"] == "tool_start" and "/tool-" in event["data"]["id"]
    ]
    assert len(executed_tools) == len(set(executed_tools))


def test_missing_coordinator_decisions_keep_requesting_a_fresh_stage_and_can_resume(monkeypatch):
    tape = IterationTape()
    tape.implement()
    tape.review(accepted=False)
    # Native stages can end without calling their terminal tool. More than the
    # coordinator's per-stage allowance of eight such stages must not fail delivery.
    for attempt in range(10):
        tape.responses.append(turn(text=f"No iteration decision for attempt {attempt}."))
    tape.coordinate("review", "Complete the independent assessment without source edits.")
    tape.review()
    interrupted = "flow-v1/iteration-0-8/llm-0"
    attempts, _, external = run_iteration(monkeypatch, tape, interrupted)
    first, resumed = attempts
    assert first["cancelled"] and first["steps"][-1]["name"] == interrupted
    assert all(step["cached"] for step in resumed["steps"][:len(first["steps"])])
    committed = resumed["committed"]
    for attempt in range(11):
        assert f"flow-v1/iteration-0-{attempt}/llm-0" in committed
    decision = committed["flow-v1/iteration-0-10/tool-1-schedule_iteration"]["output"]
    assert decision["stage"] == "flow-v1/iteration-0-10"
    assert sum(item["kind"] == "compiler" for item in external.calls) == 1
    assert not any("review-repair-" in key for key in committed)
