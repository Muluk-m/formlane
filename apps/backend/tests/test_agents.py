import copy
import json
import os
from concurrent.futures import CancelledError, ThreadPoolExecutor
from contextlib import nullcontext
from threading import Barrier
from types import SimpleNamespace

os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CREWAI_TRACING_ENABLED"] = "false"

import pytest
from crewai import Task
from crewai.llms.providers.openai.completion import OpenAICompletion
from openai.types.chat import ChatCompletionChunk

from formlane.delivery import execute_harness
from formlane.delivery._crewai import ObservedOpenAI, SourceExecutor
from formlane.delivery.errors import HarnessFailure, RuntimeAbort
from formlane.delivery.flow import DeliveryFlow
from formlane.delivery.schemas import ChecksArgs
from formlane.delivery.stages import Delivery
from formlane.delivery.tools import tools_for_stage
from formlane.delivery.workspace import (
    SMOKE_CHECK_NAME,
    Runtime,
    apply_file_edits,
    checks_hash,
    completion_status,
    current_build,
    require_clock_coverage,
    search_source,
    source_changes,
)
from formlane.project import artifact_hash, create_source, source_hash


class Checkpoints:
    def __init__(self):
        self.values = {}

    def run(self, name, fn):
        if name not in self.values:
            self.values[name] = copy.deepcopy(fn())
        return copy.deepcopy(self.values[name])

    def orchestrate(self, name, fn):
        return self.run(name, fn)

    def events(self, name, attempt=0):
        return nullcontext()


def runtime(previous=None, checks=None):
    events = []
    result = Runtime(
        SimpleNamespace(),
        {
            "runId": "run",
            "projectId": "project",
            "idea": "obsolete +1",
            "request": "Change color",
            "previousSource": previous,
            "previousChecks": checks,
        },
        Checkpoints(),
        lambda kind, data: events.append((kind, data)),
        lambda: False,
    )
    return result, events


def accepted_workspace():
    rt, _ = runtime(create_source("vanilla"))
    state = rt.workspace
    state["html"] = (
        '<!doctype html><html><body><p id="status">Validated</p>'
        "<button onclick=\"document.querySelector('#status').textContent='Reviewed'\">"
        "Review</button></body></html>"
    )
    state["checks"] = [{"name": "one"}, {"name": "two"}]
    state["build"] = {
        "revision": 0,
        "sourceHash": source_hash(state["source"]),
        "artifactHash": artifact_hash(state["html"]),
    }
    state["implementationValidation"] = dict(state["build"])
    state["report"] = {
        "valid": True,
        "artifactHash": state["build"]["artifactHash"],
        "issues": [],
        "checks": [],
    }
    state["validatedBy"] = "david"
    state["independentValidation"] = {
        "artifactHash": state["build"]["artifactHash"],
        "checksHash": checks_hash(state["checks"]),
    }
    state["review"] = {
        **state["build"],
        "accepted": True,
        "findings": "Verified",
        "checksHash": checks_hash(state["checks"]),
    }
    rt.scope = rt.new_scope("flow-v1/review-0", "david")
    for key, width in (("desktop", 1280), ("mobile", 375)):
        state["visualEvidence"][key] = {
            **state["build"], "id": key, "target": "current", "role": "david",
            "stage": rt.scope["path"], "resolution": {"status": "resolved"},
            "image": {"provenance": "server-reconstructed", "mimeType": "image/png",
                      "base64": "cGl4ZWxz", "width": width, "height": 812},
        }
        state["visualReceipts"][key] = rt.scope["path"]
    state["review"]["visualEvidenceIds"] = ["desktop", "mobile"]
    return rt


def test_completion_requires_each_exact_evidence_stamp():
    assert completion_status(accepted_workspace().workspace)["ready"]
    mutations = [
        lambda s: s.update(html=s["html"] + "changed"),
        lambda s: s["source"]["files"].update({"extra.js": "console.log(1)"}),
        lambda s: s["independentValidation"].update(checksHash="stale"),
        lambda s: s.update(independentValidation=None),
        lambda s: s["implementationValidation"].update(sourceHash="stale"),
        lambda s: s["review"].update(checksHash="stale"),
        lambda s: s["review"].update(accepted=False),
        lambda s: s["independentValidation"].update(artifactHash="stale"),
        lambda s: s.update(revision=1),
    ]
    for mutate in mutations:
        state = accepted_workspace().workspace
        mutate(state)
        assert not completion_status(state)["ready"]


def test_previous_source_is_immutable_and_original_idea_omitted():
    source = create_source("vanilla")
    rt, _ = runtime(source)
    baseline = source["files"]["index.html"]
    source["files"]["index.html"] = "caller changed"
    rt.workspace["source"]["files"]["index.html"] = "candidate changed"
    assert rt.read_previous_file({"path": "index.html"})["content"] == baseline
    with pytest.raises(TypeError):
        rt.previous["files"]["index.html"] = "not allowed"
    assert "originalIdea" not in rt.workspace_info()
    assert "obsolete +1" not in str(rt.workspace_info())
    assert {"path": "index.html", "status": "modified"} in source_changes(
        rt.workspace["source"], rt.previous
    )


def test_atomic_edits_reject_stale_ambiguous_noop_and_keep_baseline():
    assert apply_file_edits("one two", [{"find": "one", "replacement": "first"}]) == "first two"
    for content, edits in [
        ("a a", [{"find": "a", "replacement": "b"}]),
        ("abc", [{"find": "z", "replacement": "b"}]),
        ("abc", [{"find": "a", "replacement": "a"}]),
        ("abc", [{"find": "a", "replacement": "x"}, {"find": "z", "replacement": "q"}]),
    ]:
        with pytest.raises(ValueError):
            apply_file_edits(content, edits)


def test_tools_are_role_scoped_and_never_execute_arbitrary_code():
    rt, _ = runtime(create_source("vanilla"))
    qa = {tool.name for tool in tools_for_stage(rt, "reviewer")}
    assert qa == {
        "read_workspace",
        "read_review_files",
        "search_files",
        "inspect_preview",
        "set_acceptance_checks",
        "validate_preview",
        "record_review",
    }
    assert {tool.name for tool in tools_for_stage(rt, "router")} == {"choose_route"}
    assert {tool.name for tool in tools_for_stage(rt, "coordinator")} == {
        "read_workspace", "schedule_iteration",
    }
    assert {tool.name for tool in tools_for_stage(rt, "planner")} == {
        "read_workspace",
        "read_previous_file",
        "read_file",
        "submit_plan",
    }
    builder = {tool.name for tool in tools_for_stage(rt, "builder")}
    assert "set_acceptance_checks" not in builder
    assert {"validate_preview", "inspect_preview", "search_files"} <= builder
    assert "set_acceptance_checks" in {tool.name for tool in tools_for_stage(rt, "quick_edit")}
    assert not any(
        "shell" in tool.name
        for kind in ("router", "coordinator", "planner", "builder", "quick_edit", "reviewer")
        for tool in tools_for_stage(rt, kind)
    )
    fresh, _ = runtime()
    assert {tool.name for tool in tools_for_stage(fresh, "planner")} == {"read_workspace", "submit_plan"}
    assert SourceExecutor._should_parallelize_native_tool_calls(None, [1, 2]) is False


def test_source_change_clears_all_evidence_and_preserves_checks():
    rt = accepted_workspace()
    rt.scope = rt.new_scope("alex", "alex")
    checks = copy.deepcopy(rt.workspace["checks"])
    source = copy.deepcopy(rt.workspace["source"])
    source["files"]["extra.js"] = "const changed = true"
    rt.invalidate(source)
    assert rt.workspace["checks"] == checks
    assert current_build(rt.workspace) is None
    assert rt.workspace["review"] is None
    assert rt.workspace["implementationValidation"] is None
    assert rt.workspace["independentValidation"] is None


def test_review_requires_own_browser_and_changed_file_inspection():
    rt = accepted_workspace()
    rt.workspace["source"]["files"]["index.html"] += "<!-- requested change -->"
    rt.workspace["build"]["sourceHash"] = source_hash(rt.workspace["source"])
    for value in rt.workspace["visualEvidence"].values():
        value["sourceHash"] = rt.workspace["build"]["sourceHash"]
    args = {"accepted": True, "findings": "Accepted", "visual_evidence_ids": ["desktop", "mobile"]}
    with pytest.raises(ValueError, match="inspection"):
        rt.record_review(args)
    rt.read_review_files({"paths": ["index.html"]})
    assert rt.record_review(args)["accepted"]
    rt.workspace["independentValidation"] = None
    with pytest.raises(ValueError):
        rt.record_review(args)


def test_native_review_recovers_missing_files_and_replays_without_provider(monkeypatch):
    rt = accepted_workspace()
    rt.previous = None
    state = rt.workspace
    state["source"] = create_source("react-ts")
    state["build"]["sourceHash"] = source_hash(state["source"])
    for value in state["visualEvidence"].values():
        value["sourceHash"] = state["build"]["sourceHash"]
    state["implementationValidation"] = dict(state["build"])
    state["review"] = None
    missing = ["package.json", "tsconfig.json"]
    rt.read_review_files({"paths": sorted(set(state["source"]["files"]) - set(missing))})
    initial = copy.deepcopy(state)
    turns = 0

    def transport(**kwargs):
        nonlocal turns
        turns += 1
        if turns == 1:
            name, args = "record_review", {"accepted": True, "findings": "Browser passed"}
        elif turns == 2:
            feedback = next(
                item["content"] for item in reversed(kwargs["messages"])
                if item["role"] == "tool"
            )
            assert all(path in feedback for path in missing)
            name, args = "read_review_files", {"paths": missing}
        elif turns == 3:
            name, args = "record_review", {"accepted": True, "findings": "Reviewed all files", "visual_evidence_ids": ["desktop", "mobile"]}
        else:
            pytest.fail("A recorded verdict must end the review stage")
        yield ChatCompletionChunk(
            id=f"review-{turns}", created=0, model="review-model",
            object="chat.completion.chunk",
            choices=[{"index": 0, "delta": {"tool_calls": [{
                "index": 0, "id": f"call-{turns}", "type": "function",
                "function": {"name": name, "arguments": json.dumps(args)},
            }]}, "finish_reason": "tool_calls"}],
        )

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=transport)))
    monkeypatch.setattr(OpenAICompletion, "_get_sync_client", lambda _: client)
    model = ObservedOpenAI(
        model="review-model", api_key="recorded-transport", base_url="http://127.0.0.1:1/v1",
        custom_openai=True, stream=True, max_retries=0,
        additional_params={"parallel_tool_calls": False},
    ).bind(rt)
    delivery = Delivery(rt, lambda effort: model)
    delivery.stage("review-0", "reviewer", "Review", {}, lambda output: output)
    assert completion_status(rt.workspace)["ready"]
    assert turns == 3
    assert set(missing).issubset(rt.workspace["reviewedPaths"])
    saved_steps = list(rt.durable.values)

    rt.workspace = initial
    delivery.stage("review-0", "reviewer", "Review", {}, lambda output: output)
    assert completion_status(rt.workspace)["ready"]
    assert turns == 3
    assert list(rt.durable.values) == saved_steps


def test_tool_checkpoint_recovers_source_without_repeating_mutation():
    rt, events = runtime(create_source("vanilla"))
    rt.scope = rt.new_scope("delegation", "alex")
    tools = {tool.name: tool for tool in tools_for_stage(rt, "builder")}
    initial = copy.deepcopy(rt.workspace)
    tools["write_file"].run(path="new.js", content="const saved = 1")
    assert rt.workspace["revision"] == 1
    assert events[-1] == ("file_saved", {"path": "new.js", "content": "const saved = 1"})
    rt.workspace = initial
    rt.scope = rt.new_scope("delegation", "alex")
    tools["write_file"].run(path="new.js", content="const saved = 1")
    assert rt.workspace["source"]["files"]["new.js"] == "const saved = 1"
    assert rt.workspace["revision"] == 1
    assert len([kind for kind, _ in events if kind == "tool_start"]) == 1


def test_missing_provider_never_generates_fallback():
    with pytest.raises(HarnessFailure) as error:
        execute_harness(SimpleNamespace(openai_api_key=""), {}, None, None, None)
    assert error.value.code == "provider"


class RecordingDelivery:
    def __init__(self, route="plan", fail=None):
        self.calls, self.route_name, self.fail = [], route, fail

    def _call(self, name):
        self.calls.append(name)
        if name == self.fail:
            raise HarnessFailure("step_limit")

    def route(self):
        self._call("route")
        return self.route_name

    def plan(self):
        self._call("plan")

    def implement(self, kind, key, label, evidence=None):
        self._call(kind)

    def verify(self):
        self._call("verify")

    def review(self):
        self._call("review")

    def deliver(self):
        self._call("deliver")
        return {"summary": "Accepted."}


@pytest.mark.parametrize(
    ("route", "expected"),
    [
        ("plan", ["route", "plan", "builder", "verify", "review", "deliver"]),
        ("quick_edit", ["route", "quick_edit", "verify", "review", "deliver"]),
    ],
)
def test_native_flow_owns_stage_order(route, expected):
    delivery = RecordingDelivery(route)
    assert DeliveryFlow(delivery).execute() == {"summary": "Accepted."}
    assert delivery.calls == expected


def test_flow_failure_halts_later_stages_and_reraises_unchanged():
    delivery = RecordingDelivery(fail="plan")
    with pytest.raises(HarnessFailure) as error:
        DeliveryFlow(delivery).execute()
    assert error.value.code == "step_limit"
    assert delivery.calls == ["route", "plan"]


def test_verification_checks_once_and_leaves_failed_evidence_for_review():
    rt, _ = runtime(create_source("vanilla"))
    delivery = Delivery(rt, None)
    checks = []
    delivery.check_candidate = lambda key: checks.append(key) or {"valid": False, "issues": ["x"]}
    delivery.repair = lambda *args: pytest.fail("Mike must arrange repairs after David's review")
    delivery.verify()
    assert checks == ["verify-0"]


@pytest.mark.parametrize("next_step", ["repair", "review"])
def test_iteration_decision_preserves_source_and_validation_evidence(next_step):
    rt = accepted_workspace()
    before = copy.deepcopy(rt.workspace)
    args = {"next_step": next_step, "instructions": "Resolve the current review findings."}
    with rt.scoped("iteration-3-0", "mike"):
        decision = rt.schedule_iteration(args)
    assert decision == {**args, "stage": "flow-v1/iteration-3-0"}
    assert rt.workspace == {**before, "iteration": decision}
    assert "iteration" not in before


def test_first_build_routes_to_plan_and_quick_edit_requires_saved_checks():
    fresh, _ = runtime()
    assert Delivery(fresh, None).route() == "plan"
    rt, _ = runtime(create_source("vanilla"))

    def choose(*args):
        rt.workspace["route"] = "quick_edit"

    delivery = Delivery(rt, None)
    delivery.stage = choose
    assert delivery.route() == "plan"


def test_saved_checks_seed_follow_up_with_one_smoke_check():
    saved = [
        {
            "name": "count",
            "actions": [],
            "assertions": [{"kind": "text", "selector": "output", "expected": "0"}],
        },
        {
            "name": SMOKE_CHECK_NAME,
            "actions": [],
            "assertions": [{"kind": "count", "selector": "body", "expected": "1"}],
        },
    ]
    rt, _ = runtime(create_source("vanilla"), saved)
    names = [check["name"] for check in rt.workspace["checks"]]
    assert names == [SMOKE_CHECK_NAME, "count"]


def test_plan_initializes_template_once_with_binding_checks():
    rt, events = runtime()
    rt.scope = rt.new_scope("plan", "emma")
    plan = {
        "brief": "Counter",
        "criteria": [
            {"id": "A1", "outcome": "Click increments"},
            {"id": "A2", "outcome": "Reset"},
        ],
        "assumptions": [],
        "gaps": [],
        "template": "vanilla",
        "architecture": "src/main.js renders [data-testid=count].",
        "checks": [
            {
                "name": "increment",
                "actions": [{"kind": "click", "selector": "button", "value": None}],
                "assertions": [{"kind": "text", "selector": "output", "expected": "1"}],
            },
            {
                "name": "initial",
                "actions": [],
                "assertions": [{"kind": "text", "selector": "output", "expected": "0"}],
            },
        ],
    }
    output = rt.invoke(rt.submit_plan, plan)
    assert output["template"] == "vanilla" and output["checks"] == 3
    assert rt.workspace["checks"][0]["name"] == SMOKE_CHECK_NAME
    assert "A1. Click increments" in rt.workspace["brief"]
    assert any(kind == "project_initialized" for kind, _ in events)
    assert "error" in rt.invoke(rt.submit_plan, plan)
    assert rt.invoke(rt.submit_candidate, {"summary": "Done"})["error"].startswith("Build")


def test_independent_review_checks_preserve_current_implementation_evidence(monkeypatch):
    rt = accepted_workspace()
    checks = [
        {
            "name": "text",
            "actions": [],
            "assertions": [{"kind": "text", "selector": "body", "expected": "Validated"}],
        },
        {
            "name": "independent interaction",
            "actions": [{"kind": "click", "selector": "button", "value": None}],
            "assertions": [
                {"kind": "text", "selector": "#status", "expected": "Reviewed"},
                {"kind": "no-horizontal-overflow", "selector": "body", "expected": "true"},
            ],
        },
    ]
    rt.set_acceptance_checks({"checks": checks})
    assert current_build(rt.workspace) is not None
    assert rt.workspace["implementationValidation"] == rt.workspace["build"]
    assert rt.workspace["report"] is None
    assert rt.workspace["review"] is None
    assert set(completion_status(rt.workspace)["missing"]) == {
        "david_validation",
        "david_acceptance",
        "david_visual_approval",
    }
    assert rt.workspace["checks"][0]["name"] == SMOKE_CHECK_NAME
    rt.settings.browser_executable = os.environ.get("BROWSER_EXECUTABLE_PATH")
    rt.scope = rt.new_scope("independent-review", "david")
    report = rt.validate_preview({})
    assert report["valid"], report["issues"]
    screenshots = [rt.invoke(rt.inspect_preview, {"viewport": viewport})["id"] for viewport in (
        {"width": 1280, "height": 720}, {"width": 375, "height": 812},
    )]

    def provider(llm, messages, *args):
        images = [part for message in messages if isinstance(message.get("content"), list)
                  for part in message["content"] if part["type"] == "image_url"]
        assert len(images) == 2
        assert all(part["image_url"]["url"].startswith("data:image/png;base64,") for part in images)
        return "Viewed both current viewport images."

    monkeypatch.setattr(OpenAICompletion, "call", provider)
    model = ObservedOpenAI(model="test", api_key="controlled").bind(rt)
    model.call("Inspect the current visual evidence.")
    review = rt.record_review(
        {"accepted": True, "findings": "Independent browser checks passed.", "visual_evidence_ids": screenshots}
    )
    assert review["completion"]["ready"]
    # Re-running implementation evidence on unchanged source keeps the independent verdict.
    rt.scope = rt.new_scope("revalidate", "alex")
    assert rt.validate_preview({})["valid"]
    assert completion_status(rt.workspace)["ready"]


def test_rejected_package_write_is_atomic_and_emits_no_saved_file():
    rt, events = runtime(create_source("vanilla"))
    rt.scope = rt.new_scope("alex", "alex")
    initial = copy.deepcopy(rt.workspace)
    tool = next(tool for tool in tools_for_stage(rt, "builder") if tool.name == "write_file")
    output = tool.run(path="package.json", content='{"scripts":{"build":"arbitrary-code"}}')
    assert "error" in output
    assert rt.workspace == initial
    assert not any(kind == "file_saved" for kind, _ in events)


def test_browser_checks_have_structured_native_function_schema():
    schema = ChecksArgs.model_json_schema()
    assert schema["properties"]["checks"]["items"]["$ref"].endswith("BrowserCheck")
    assert "BrowserAction" in schema["$defs"]
    assert "BrowserAssertion" in schema["$defs"]
    assert schema["$defs"]["BrowserCheck"]["additionalProperties"] is False


def dated_check(name, now=None, expected="本周日 2026-03-22"):
    check = {
        "name": name,
        "actions": [{"kind": "click", "selector": "button", "value": None}],
        "assertions": [{"kind": "text", "selector": "output", "expected": expected}],
    }
    if now:
        check["clock"] = {"now": now, "timezone": "Asia/Shanghai"}
    return check


def test_calendar_expectations_require_two_pinned_clocks():
    from formlane.validator import validate_checks

    with pytest.raises(ValueError, match="clock.now"):
        require_clock_coverage(validate_checks([dated_check("a"), dated_check("b")]))
    one_moment = [dated_check("a", "2026-03-18T10:00:00+08:00")] * 2
    with pytest.raises(ValueError, match="two different"):
        require_clock_coverage(validate_checks(one_moment))
    require_clock_coverage(
        validate_checks(
            [
                dated_check("wed", "2026-03-18T10:00:00+08:00"),
                dated_check("fri", "2026-03-20T10:00:00+08:00", "本周日 3月22日"),
            ]
        )
    )
    # Undated checks need no clock.
    require_clock_coverage(validate_checks([dated_check("a", expected="2 件")] * 2))


def built_runtime():
    rt = accepted_workspace()
    rt.scope = rt.new_scope("build", "alex")
    rt.workspace["review"] = rt.workspace["independentValidation"] = None
    return rt


def test_builder_submits_only_after_passing_validation_or_named_check_defects():
    rt = built_runtime()
    assert rt.submit_candidate({"summary": "Done", "check_defects": []})["submitted"]
    rt = built_runtime()
    rt.workspace["implementationValidation"] = rt.workspace["report"] = None
    with pytest.raises(ValueError, match="validate_preview"):
        rt.submit_candidate({"summary": "Done", "check_defects": []})
    rt.workspace["report"] = {
        "valid": False,
        "artifactHash": rt.workspace["build"]["artifactHash"],
        "issues": ["wrong"],
        "checks": [{"name": "one", "passed": True}, {"name": "two", "passed": False}],
    }
    with pytest.raises(ValueError, match="two"):
        rt.submit_candidate({"summary": "Done", "check_defects": []})
    rt.submit_candidate({"summary": "Check two is wrong", "check_defects": ["two"]})
    assert rt.workspace["candidate"]["checkDefects"] == ["two"]


def test_verify_trusts_current_builder_evidence_and_routes_disputes_to_review():
    rt = built_runtime()
    delivery = Delivery(rt, None)
    delivery.check_candidate = lambda key: pytest.fail("Fresh evidence must not be re-run")
    delivery.verify()

    rt.workspace["implementationValidation"] = None
    rt.workspace["candidate"] = {"summary": "x", "revision": 0, "checkDefects": ["two"]}
    repairs = []
    delivery.check_candidate = lambda key: {
        "valid": False,
        "issues": ["two failed"],
        "checks": [{"name": "two", "passed": False}],
    }
    delivery.repair = lambda key, issues: repairs.append(key)
    delivery.verify()
    assert repairs == []


def test_search_files_returns_literal_matches_with_lines():
    source = {"template": "vanilla", "files": {"src/a.js": "const Total = 1\nlet x = total()\n"}}
    found = search_source(source, "total", True)
    assert [match["line"] for match in found["matches"]] == [1, 2]
    assert search_source(source, "total", False)["matches"][0]["line"] == 2
    assert search_source(source, "(.*)*", False) == {"matches": [], "truncated": False}


@pytest.fixture
def native_inspections(monkeypatch):
    """Record transport only; run stage hooks and tools through the native executor."""
    clients = {}
    monkeypatch.setattr(OpenAICompletion, "_get_sync_client", lambda model: clients[model.model])

    def run(rt, key, arguments, *, scoped=True, before_tools=None, durable_model=True):
        outputs = []
        requested = False

        def chunk(delta, finish_reason=None):
            return ChatCompletionChunk(
                id="budget-response", created=0, model="budget-model",
                object="chat.completion.chunk",
                choices=[{"index": 0, "delta": delta, "finish_reason": finish_reason}],
            )

        def transport(**kwargs):
            nonlocal requested
            if not requested:
                requested = True
                for index, args in enumerate(arguments):
                    yield chunk({"tool_calls": [{
                        "index": index, "id": f"inspect-{index}", "type": "function",
                        "function": {"name": "inspect_preview", "arguments": json.dumps(args)},
                    }]})
                yield chunk({}, "tool_calls")
                if before_tools is not None:
                    before_tools()
            else:
                outputs.extend(
                    item["content"] for item in kwargs["messages"] if item["role"] == "tool"
                )
                yield chunk({"content": "Decision recorded"})
                yield chunk({}, "stop")

        model_name = f"budget-{id(rt)}-{key}"
        clients[model_name] = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=transport))
        )
        model_type = ObservedOpenAI if durable_model else OpenAICompletion
        model = model_type(
            model=model_name, api_key="recorded-transport", base_url="http://127.0.0.1:1/v1",
            custom_openai=True, stream=True, max_retries=0,
            additional_params={"parallel_tool_calls": False},
        )
        if durable_model:
            model.bind(rt)
        delivery = Delivery(rt, lambda effort: model)
        if scoped:
            result = delivery.stage(key, "reviewer", "Review", {}, lambda output: output)
        else:
            with rt.scoped(key, "david"):
                agent = delivery.agent("reviewer")
                task = Task(description="Review", expected_output="Decision", agent=agent)
                result = agent.execute_task(task, None, agent.tools)
        assert result == "Decision recorded"
        return outputs

    return run


def test_stage_tool_budgets_force_a_decision(monkeypatch, native_inspections):
    rt = accepted_workspace()
    calls = []
    monkeypatch.setattr(
        "formlane.delivery.workspace.inspect_artifact",
        lambda *args: calls.append(args) or {"ok": True},
    )
    arguments = [{"selector": f"#item-{index}"} for index in range(7)]
    outputs = native_inspections(rt, "review", arguments)
    assert len(calls) == 6
    assert all(json.loads(output) == {"ok": True} for output in outputs[:6])
    assert json.loads(outputs[-1]) == {
        "error": "inspect_preview budget of 6 for this stage is used up. "
        "Decide with the evidence you have and call record_review now."
    }
    saved_steps = list(rt.durable.values)
    native_inspections(rt, "review", arguments)
    assert len(calls) == 6
    assert list(rt.durable.values) == saved_steps
    assert "budget" not in native_inspections(rt, "review-1", [{"selector": "body"}])[0]
    assert len(calls) == 7


def test_malformed_native_arguments_preserve_validation_and_budget(monkeypatch, native_inspections):
    calls = []
    monkeypatch.setattr(
        "formlane.delivery.workspace.inspect_artifact",
        lambda *args: calls.append(args) or {"ok": True},
    )
    arguments = [{"selector": 123}]
    arguments.extend({"selector": f"#item-{index}"} for index in range(6))
    arguments.extend([{"selector": 456}, {"selector": "#denied"}])
    outputs = native_inspections(accepted_workspace(), "review", arguments)
    assert len(calls) == 6
    for index in (0, 7):
        assert "validation error" in outputs[index]
        assert "selector" in outputs[index]
        assert "budget" not in outputs[index]
    assert all(json.loads(output) == {"ok": True} for output in outputs[1:7])
    assert "budget of 6" in outputs[8]


def test_stage_hooks_clean_up_after_authority_abort(monkeypatch, native_inspections):
    rt = accepted_workspace()
    cancelled = [False]
    rt.cancelled = lambda: cancelled[0]
    calls = []
    monkeypatch.setattr(
        "formlane.delivery.workspace.inspect_artifact",
        lambda *args: calls.append(args) or {"ok": True},
    )
    with pytest.raises(RuntimeAbort) as aborted:
        # Use the installed provider directly so cancellation first reaches PRE,
        # rather than the durable provider's earlier end-of-call authority check.
        native_inspections(
            rt, "review", [{"selector": "body"}],
            before_tools=lambda: cancelled.__setitem__(0, True),
            durable_model=False,
        )
    assert isinstance(aborted.value.cause, CancelledError)
    assert calls == []
    # Outside a stage scope the native executor must not retain the aborted runtime's hook.
    arguments = [{"selector": f"#item-{index}"} for index in range(7)]
    outputs = native_inspections(accepted_workspace(), "unscoped", arguments, scoped=False)
    assert len(calls) == 7
    assert all(json.loads(output) == {"ok": True} for output in outputs)


def test_concurrent_native_stages_keep_independent_budgets(monkeypatch, native_inspections):
    monkeypatch.setattr("formlane.delivery.workspace.inspect_artifact", lambda *args: {"ok": True})
    barrier = Barrier(2)
    arguments = [{"selector": f"#item-{index}"} for index in range(7)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(
                native_inspections, accepted_workspace(), "review", arguments,
                before_tools=lambda: barrier.wait(timeout=10),
            )
            for _ in range(2)
        ]
        results = [future.result(timeout=30) for future in futures]
    for outputs in results:
        assert len(outputs) == 7
        assert all(json.loads(output) == {"ok": True} for output in outputs[:6])
        assert "budget of 6" in outputs[-1]
    outputs = native_inspections(accepted_workspace(), "unscoped", arguments, scoped=False)
    assert all(json.loads(output) == {"ok": True} for output in outputs)
