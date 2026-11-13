import copy
import json
import os
from concurrent.futures import CancelledError
from types import SimpleNamespace

os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CREWAI_TRACING_ENABLED"] = "false"

import pytest

from formlane.agents import (
    ChecksArgs,
    HarnessFailure,
    Runtime,
    SourceExecutor,
    apply_file_edits,
    completion_status,
    current_build,
    execute_harness,
    source_changes,
)
from formlane.model_stream import RuntimeAbort
from formlane.project import artifact_hash, create_source, source_hash


class Checkpoints:
    def __init__(self):
        self.values = {}
        self.order = []
        self.inside_step = False

    def run(self, name, fn):
        assert not self.inside_step, "Model/tool operations must be independent steps"
        if name not in self.values:
            self.inside_step = True
            try:
                value = fn()
            finally:
                self.inside_step = False
            self.values[name] = copy.deepcopy(value)
            self.order.append(name)
        return copy.deepcopy(self.values[name])

    def orchestrate(self, name, fn):
        assert not self.inside_step, "A Crew must not execute inside a step"
        return fn()


def runtime(previous=None, request="Build a transient counter", durable=None):
    events = []
    result = Runtime(
        SimpleNamespace(),
        {
            "runId": "run",
            "projectId": "project",
            "idea": "obsolete +1",
            "request": request,
            "previousSource": previous,
        },
        durable or Checkpoints(),
        lambda kind, data: events.append((kind, data)),
        lambda: False,
    )
    return result, events


def contract_args(request, capabilities=None):
    return {
        "brief": "Implement the requested counter with transient page state.",
        "assumptions": [],
        "requirements": [
            {
                "id": "A1",
                "description": request,
                "acceptance": "The requested control changes its visible state.",
                "capabilities": capabilities or ["frontend", "memory"],
                "evidence": [
                    {
                        "origin": "request",
                        "path": None,
                        "quote": request,
                        "explanation": "This is the current requested behavior.",
                    }
                ],
            }
        ],
    }


def checks(expected="1"):
    return [
        {
            "name": "initial state",
            "requirementIds": ["A1"],
            "actions": [],
            "assertions": [{"kind": "text", "selector": "output", "expected": "0"}],
        },
        {
            "name": "increment",
            "requirementIds": ["A1"],
            "actions": [{"kind": "click", "selector": "button", "value": None}],
            "assertions": [{"kind": "text", "selector": "output", "expected": expected}],
        },
    ]


def review_args(accepted=True):
    return {
        "accepted": accepted,
        "summary": "Reviewed the current counter and baseline.",
        "assessments": [
            {
                "requirementId": "A1",
                "passed": accepted,
                "evidence": "Inspected source and observed output after the increment action.",
            }
        ],
        "findings": []
        if accepted
        else [
            {
                "requirementId": "A1",
                "observation": "Increment produces two.",
                "correction": "Preserve the requested increment of one.",
            }
        ],
    }


def call(rt, name, **args):
    tool = next(tool for tool in rt.tools(rt.scope["role"]) if tool.name == name)
    output = json.loads(tool.run(**args))
    assert "error" not in output, output
    return output


def wire_stages(monkeypatch, rt, capabilities=None, implement=None, review=None):
    stages = []

    def run_stage(role, path, packet):
        stages.append((role, path, copy.deepcopy(packet)))
        parent = rt.scope

        def execute():
            rt.scope = rt.new_scope(path, role)
            if role == "emma":
                call(rt, "submit_contract", **contract_args(rt.context["request"], capabilities))
            elif role == "alex":
                if not rt.workspace["source"]:
                    call(
                        rt,
                        "initialize_project",
                        template="vanilla",
                        reason="Implement requested interface",
                    )
                if implement:
                    implement(rt, int(path.rsplit("/", 1)[1]), packet)
                elif rt.workspace["source"]["files"]["src/main.js"] != "const counter = 0;":
                    call(rt, "write_file", path="src/main.js", content="const counter = 0;")
                if rt.required_ids():
                    call(rt, "set_acceptance_checks", checks=checks())
                call(rt, "finish_candidate", summary="Implemented the requested counter.")
            else:
                call(
                    rt,
                    "read_review_files",
                    paths=[
                        item["path"] for item in source_changes(rt.workspace["source"], rt.previous)
                    ],
                )
                call(rt, "set_review_checks", checks=checks())
                call(rt, "validate_preview")
                args = review(rt, packet) if review else review_args()
                call(rt, "record_review", **args)
            return "Stage completed"

        try:
            return rt.durable.orchestrate(path, execute)
        finally:
            rt.scope = parent

    monkeypatch.setattr(rt, "run_stage", run_stage)
    return stages


def wire_gates(monkeypatch, rt, compile_error=None, browser_valid=True):
    calls = []

    def compile_source(source, *_):
        calls.append("compile")
        assert any(name.startswith("flow-v2/candidate/") for name in rt.durable.values)
        if compile_error:
            raise ValueError(compile_error)
        return {
            "sourceHash": source_hash(source),
            "html": f"<!doctype html><html><body>{source_hash(source)}</body></html>",
        }

    def validate(html, plan, *_):
        calls.append("browser")
        assert any(
            value.get("html") == html
            for name, value in rt.durable.values.items()
            if name.startswith("flow-v2/candidate/")
        )
        return {
            "valid": browser_valid,
            "artifactHash": artifact_hash(html),
            "checks": [{"name": item["name"], "passed": browser_valid} for item in plan],
            "issues": [] if browser_valid else ["Increment has the wrong visible result."],
        }

    monkeypatch.setattr("formlane.agents.compile_project", compile_source)
    monkeypatch.setattr("formlane.agents.validate_artifact", validate)
    return calls


def successful_runtime(monkeypatch):
    rt, events = runtime()
    stages = wire_stages(monkeypatch, rt)
    gates = wire_gates(monkeypatch, rt)
    result = rt.run_workflow()
    return rt, events, stages, gates, result


def test_stages_persist_candidate_then_compile_validate_review_and_accept(monkeypatch):
    rt, events, stages, gates, result = successful_runtime(monkeypatch)
    assert [role for role, _, _ in stages] == ["emma", "alex", "david"]
    assert gates == ["compile", "browser", "browser"]
    assert completion_status(rt.workspace)["ready"]
    assert result == {
        "source": rt.workspace["source"],
        "html": rt.workspace["html"],
        "summary": "Implemented the requested counter.",
    }
    order = rt.durable.order
    assert order.index("flow-v2/candidate/000000") < order.index("flow-v2/compile/0")
    assert order.index("flow-v2/compile/0") < order.index("flow-v2/candidate/000001")
    assert order.index("flow-v2/candidate/000001") < order.index("flow-v2/validate/0")
    assert all(name.startswith("flow-v2/") for name in order)
    controller_events = [
        data
        for kind, data in events
        if kind in ("tool_start", "tool_end")
        and data["id"] in ("flow-v2/compile/0", "flow-v2/validate/0")
    ]
    assert controller_events and all("agent" not in data for data in controller_events)
    assert not any(data.get("agent") == "mike" for _, data in events)


def test_frozen_contract_and_baseline_reach_every_packet(monkeypatch):
    previous = create_source("vanilla")
    previous["files"]["src/main.js"] = "const increment = 2;"
    rt, _ = runtime(previous, "Change the color")
    stages = wire_stages(monkeypatch, rt)
    wire_gates(monkeypatch, rt)
    rt.run_workflow()
    frozen = rt.workspace["contract"]
    for _, _, packet in stages[1:]:
        assert packet["contract"] == frozen
        assert packet["baseline"] == previous
        assert packet["request"] == "Change the color"
        assert "obsolete +1" not in str(packet)
    rt.scope = rt.new_scope("flow-v2/analyze-again", "emma")
    with pytest.raises(ValueError, match="frozen"):
        rt.operation("submit_contract", contract_args("Change the color"))
    assert rt.workspace["contract"] == frozen
    previous["files"]["src/main.js"] = "external mutation"
    assert rt.previous["files"]["src/main.js"] == "const increment = 2;"
    with pytest.raises(TypeError):
        rt.previous["files"]["src/main.js"] = "forbidden"


@pytest.mark.parametrize(
    "capability",
    ["durable_storage", "shared_storage", "browser_storage", "network", "server", "auth"],
)
def test_unavailable_capability_fails_with_honest_saved_source(monkeypatch, capability):
    rt, _ = runtime(request=f"Implement real {capability} for records")
    stages = wire_stages(monkeypatch, rt, capabilities=["frontend", capability])
    gates = wire_gates(monkeypatch, rt)
    with pytest.raises(HarnessFailure) as error:
        rt.run_workflow()
    assert error.value.code == "capability"
    assert [role for role, _, _ in stages] == ["emma", "alex"]
    assert gates == ["compile"]
    candidate = rt.durable.values["flow-v2/candidate/000001"]
    assert candidate["source"] and candidate["html"]
    assert candidate["sourceHash"] == source_hash(candidate["source"])
    assert candidate["artifactHash"] == artifact_hash(candidate["html"])
    assert candidate["contract"]["blockers"][0]["capabilities"] == [capability]
    assert not completion_status(rt.workspace)["ready"]


@pytest.mark.parametrize(
    "prompt",
    [
        "A frontend prototype of a neighborhood tool library with borrowing controls",
        "An in-session shopping cart with customers and inventory",
        "A transient booking interface with fake sample users clearly labeled as a mockup",
    ],
)
def test_business_nouns_do_not_reject_supported_frontend_scope(monkeypatch, prompt):
    rt, _ = runtime(request=prompt)
    wire_stages(monkeypatch, rt)
    wire_gates(monkeypatch, rt)
    rt.run_workflow()
    assert rt.workspace["contract"]["blockers"] == []
    assert completion_status(rt.workspace)["ready"]


def test_capability_evidence_must_be_grounded_in_request_or_baseline():
    rt, _ = runtime(create_source("vanilla"))
    rt.scope = rt.new_scope("flow-v2/analyze", "emma")
    args = contract_args(rt.context["request"], ["shared_storage"])
    args["requirements"][0]["evidence"][0]["quote"] = "Store all customers permanently"
    with pytest.raises(ValueError, match="exact request"):
        rt.operation("submit_contract", args)
    assert rt.workspace["contract"] is None
    args["requirements"][0]["evidence"][0] = {
        "origin": "baseline",
        "path": "src/main.js",
        "quote": "Application",
        "explanation": "Preserve the existing visible heading.",
    }
    rt.operation("submit_contract", args)
    assert rt.workspace["contract"]["baselineHash"] == source_hash(rt.context["previousSource"])


def test_compile_failure_retains_source_without_false_html_and_stops_no_change(monkeypatch):
    rt, _ = runtime()
    stages = wire_stages(monkeypatch, rt)
    gates = wire_gates(monkeypatch, rt, compile_error="Unresolved import in src/main.js")
    with pytest.raises(HarnessFailure) as error:
        rt.run_workflow()
    assert error.value.code == "validation"
    assert [role for role, _, _ in stages] == ["emma", "alex", "alex"]
    assert gates == ["compile"]
    candidate = rt.durable.values["flow-v2/candidate/000002"]
    assert candidate["source"]
    assert candidate["html"] is None and candidate["artifactHash"] is None
    assert "no source or check-plan change" in rt.durable.values["flow-v2/failure"]["reason"]
    assert stages[-1][2]["diagnostics"] == [
        {"gate": "compile", "error": "Unresolved import in src/main.js"}
    ]


def test_validation_failure_never_returns_accepted_result(monkeypatch):
    rt, _ = runtime()
    stages = wire_stages(monkeypatch, rt)
    gates = wire_gates(monkeypatch, rt, browser_valid=False)
    with pytest.raises(HarnessFailure, match="validation"):
        rt.run_workflow()
    assert "david" not in [role for role, _, _ in stages]
    assert gates == ["compile", "browser"]
    assert rt.durable.values["flow-v2/candidate/000001"]["html"]
    assert not completion_status(rt.workspace)["ready"]


def test_repairs_are_bounded_even_when_source_keeps_changing(monkeypatch):
    rt, _ = runtime()

    def implement(rt, round_index, packet):
        call(rt, "write_file", path="src/main.js", content=f"const counter = {round_index};")

    stages = wire_stages(monkeypatch, rt, implement=implement)
    gates = wire_gates(monkeypatch, rt, compile_error="A required import is missing")
    with pytest.raises(HarnessFailure, match="validation"):
        rt.run_workflow()
    assert [role for role, _, _ in stages].count("emma") == 1
    assert [role for role, _, _ in stages].count("alex") == 3
    assert gates == ["compile"] * 3
    assert "allowance exhausted" in rt.durable.values["flow-v2/failure"]["reason"]
    assert (
        rt.durable.values["flow-v2/candidate/000004"]["source"]["files"]["src/main.js"]
        == "const counter = 2;"
    )


def test_review_rejection_routes_concrete_repair_then_fresh_validation(monkeypatch):
    rt, _ = runtime()

    def implement(rt, round_index, packet):
        if round_index:
            assert packet["diagnostics"][0]["review"]["findings"][0]["requirementId"] == "A1"
        call(
            rt,
            "write_file",
            path="src/main.js",
            content=f"const increment = {2 if round_index == 0 else 1};",
        )

    def review(rt, packet):
        return review_args(packet["repairRound"] > 0)

    stages = wire_stages(monkeypatch, rt, implement=implement, review=review)
    gates = wire_gates(monkeypatch, rt)
    result = rt.run_workflow()
    assert [role for role, _, _ in stages] == ["emma", "alex", "david", "alex", "david"]
    assert gates == ["compile", "browser", "browser"] * 2
    assert "increment = 1" in result["source"]["files"]["src/main.js"]
    assert stages[1][2]["contract"] == stages[-1][2]["contract"]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda state: state.update(html=state["html"] + "changed"),
        lambda state: state["source"]["files"].update({"extra.js": "changed"}),
        lambda state: state["implementationValidation"].update(sourceHash="stale"),
        lambda state: state["implementationValidation"].update(contractHash="stale"),
        lambda state: state["independentValidation"].update(checksHash="stale"),
        lambda state: state["review"].update(contractHash="stale"),
        lambda state: state["review"].update(reviewerScope="implementation"),
        lambda state: state["review"].update(accepted=False),
        lambda state: state.update(revision=100),
    ],
)
def test_completion_rejects_stale_artifact_contract_checks_or_independence(monkeypatch, mutate):
    rt, *_ = successful_runtime(monkeypatch)
    mutate(rt.workspace)
    assert not completion_status(rt.workspace)["ready"]


def test_source_change_invalidates_all_evidence_without_changing_contract(monkeypatch):
    rt, *_ = successful_runtime(monkeypatch)
    frozen = copy.deepcopy(rt.workspace["contract"])
    plan = copy.deepcopy(rt.workspace["checks"])
    source = copy.deepcopy(rt.workspace["source"])
    source["files"]["extra.js"] = "const changed = true"
    rt.invalidate(source)
    assert rt.workspace["contract"] == frozen
    assert rt.workspace["checks"] == plan
    assert current_build(rt.workspace) is None
    assert all(
        rt.workspace[key] is None
        for key in ("review", "implementationValidation", "independentValidation")
    )


def test_reviewer_cannot_edit_source_or_weaken_frozen_requirement_coverage(monkeypatch):
    rt, *_ = successful_runtime(monkeypatch)
    rt.scope = rt.new_scope("flow-v2/review/new", "david")
    initial = copy.deepcopy(rt.workspace)
    with pytest.raises(ValueError, match="cannot perform"):
        rt.operation("write_file", {"path": "src/main.js", "content": "changed"})
    with pytest.raises(ValueError, match="cannot perform"):
        rt.operation("set_acceptance_checks", {"checks": checks()})
    weakened = checks()
    for check in weakened:
        check["requirementIds"] = ["invented"]
    with pytest.raises(ValueError, match="frozen requirement"):
        rt.operation("set_review_checks", {"checks": weakened})
    assert rt.workspace == initial


def test_acceptance_requires_current_independent_inspection_and_assessments(monkeypatch):
    rt, *_ = successful_runtime(monkeypatch)
    rt.scope = rt.new_scope("flow-v2/review/0", "david")
    rt.workspace["reviewedPaths"] = []
    with pytest.raises(ValueError, match="inspection"):
        rt.operation("record_review", review_args())
    rt.operation("read_review_files", {"paths": list(rt.workspace["source"]["files"])})
    rt.workspace["independentValidation"]["scope"] = "different-review"
    with pytest.raises(ValueError, match="independent"):
        rt.operation("record_review", review_args())
    incomplete = review_args()
    incomplete["assessments"] = []
    with pytest.raises(ValueError, match="Assess every"):
        rt.operation("record_review", incomplete)


def test_replay_reuses_individual_tools_compiler_and_browser_results(monkeypatch):
    rt, _, _, gates, result = successful_runtime(monkeypatch)
    durable = rt.durable
    count = len(durable.values)
    resumed, _ = runtime(durable=durable)
    wire_stages(monkeypatch, resumed)
    replay = resumed.run_workflow()
    assert replay == result
    assert len(durable.values) == count
    assert gates == ["compile", "browser", "browser"]
    assert completion_status(resumed.workspace)["ready"]


def test_cancellation_fences_cached_tool_and_candidate_results(monkeypatch):
    rt, *_ = successful_runtime(monkeypatch)
    before = copy.deepcopy(rt.workspace)
    rt.cancelled = lambda: True
    with pytest.raises(CancelledError):
        rt.persist_candidate(1)
    with pytest.raises(CancelledError):
        rt.durable_operation("flow-v2/compile/0", "build_project", {})
    assert rt.workspace == before


def test_cancellation_after_candidate_checkpoint_prevents_compilation(monkeypatch):
    rt, _ = runtime()
    wire_stages(monkeypatch, rt)
    gates = wire_gates(monkeypatch, rt)
    original = rt.durable.run

    def cancel_after_save(name, function):
        saved = original(name, function)
        if name == "flow-v2/candidate/000000":
            rt.cancelled = lambda: True
        return saved

    monkeypatch.setattr(rt.durable, "run", cancel_after_save)
    with pytest.raises(CancelledError):
        rt.run_workflow()
    assert gates == []
    assert rt.durable.values["flow-v2/candidate/000000"]["source"]


def test_tool_checkpoint_recovers_source_without_repeating_mutation():
    rt, events = runtime(create_source("vanilla"))
    rt.scope = rt.new_scope("flow-v2/implement/0", "alex")
    initial = copy.deepcopy(rt.workspace)
    call(rt, "write_file", path="new.js", content="const saved = 1")
    rt.workspace = initial
    rt.scope = rt.new_scope("flow-v2/implement/0", "alex")
    call(rt, "write_file", path="new.js", content="const saved = 1")
    assert rt.workspace["source"]["files"]["new.js"] == "const saved = 1"
    assert rt.workspace["revision"] == 1
    assert len([kind for kind, _ in events if kind == "tool_start"]) == 1


def test_atomic_edits_and_package_protection():
    assert apply_file_edits("one two", [{"find": "one", "replacement": "first"}]) == "first two"
    for content, edits in [
        ("a a", [{"find": "a", "replacement": "b"}]),
        ("abc", [{"find": "z", "replacement": "b"}]),
        ("abc", [{"find": "a", "replacement": "a"}]),
        ("abc", [{"find": "a", "replacement": "x"}, {"find": "z", "replacement": "q"}]),
    ]:
        with pytest.raises(ValueError):
            apply_file_edits(content, edits)
    rt, events = runtime(create_source("vanilla"))
    rt.scope = rt.new_scope("flow-v2/implement/0", "alex")
    initial = copy.deepcopy(rt.workspace)
    tool = next(tool for tool in rt.tools("alex") if tool.name == "write_file")
    assert "error" in tool.run(
        path="package.json", content='{"scripts":{"build":"arbitrary-code"}}'
    )
    assert rt.workspace == initial
    assert not any(kind == "file_saved" for kind, _ in events)


def test_native_single_worker_crew_has_no_manager_or_delegation(monkeypatch):
    captured = []

    def kickoff(crew):
        captured.append(crew)
        raise HarnessFailure("validation")

    monkeypatch.setattr("formlane.agents.Crew.kickoff", kickoff)
    settings = SimpleNamespace(
        openai_api_key="test-only", endpoint="http://127.0.0.1:1/v1", model="test"
    )
    rt, _ = runtime()
    with pytest.raises(HarnessFailure):
        execute_harness(settings, rt.context, Checkpoints(), lambda *_: None, lambda: False)
    crew = captured[0]
    assert crew.process.value == "sequential"
    assert crew.manager_agent is None
    assert len(crew.agents) == 1 and crew.agents[0].role == "Emma"
    assert not crew.agents[0].allow_delegation
    assert not crew.cache and not crew.memory and not crew.planning


def test_missing_provider_never_generates_fallback():
    with pytest.raises(HarnessFailure) as error:
        execute_harness(SimpleNamespace(openai_api_key=""), {}, None, None, None)
    assert error.value.code == "provider"


def test_tools_are_role_scoped_and_checks_have_native_structured_schema():
    rt, _ = runtime(create_source("vanilla"))
    assert {tool.name for tool in rt.tools("david")} == {
        "read_workspace",
        "read_review_files",
        "set_review_checks",
        "validate_preview",
        "record_review",
    }
    assert "build_project" not in {tool.name for tool in rt.tools("alex")}
    assert not any(
        "shell" in tool.name for role in ("emma", "alex", "david") for tool in rt.tools(role)
    )
    assert SourceExecutor._should_parallelize_native_tool_calls(None, [1, 2]) is False
    schema = ChecksArgs.model_json_schema()
    assert schema["properties"]["checks"]["items"]["$ref"].endswith("RequirementCheck")
    assert "BrowserAction" in schema["$defs"]
    assert "BrowserAssertion" in schema["$defs"]
    assert schema["$defs"]["RequirementCheck"]["additionalProperties"] is False


def test_plain_implementation_handoff_still_requires_controller_gates(monkeypatch):
    rt, _ = runtime()
    wire_stages(monkeypatch, rt)
    stage = rt.run_stage

    def without_terminal_summary(role, path, packet):
        result = stage(role, path, packet)
        if role == "alex":
            rt.workspace["candidateSummary"] = None
            return "Implemented a transient counter."
        return result

    monkeypatch.setattr(rt, "run_stage", without_terminal_summary)
    gates = wire_gates(monkeypatch, rt)
    result = rt.run_workflow()
    assert gates == ["compile", "browser", "browser"]
    assert result["summary"] == "Implemented a transient counter."


def test_final_answer_cannot_bypass_missing_browser_coverage(monkeypatch):
    rt, _ = runtime()
    wire_stages(monkeypatch, rt)
    stage = rt.run_stage

    def missing_checks(role, path, packet):
        result = stage(role, path, packet)
        if role == "alex":
            rt.workspace["checks"] = []
            return "Everything is finished and tested."
        return result

    monkeypatch.setattr(rt, "run_stage", missing_checks)
    gates = wire_gates(monkeypatch, rt)
    with pytest.raises(HarnessFailure, match="validation"):
        rt.run_workflow()
    assert gates == ["compile"]
    assert "flow-v2/validate/0" in rt.durable.values
    assert "error" in rt.durable.values["flow-v2/validate/0"]["output"]
    assert not completion_status(rt.workspace)["ready"]


def test_independent_check_changes_preserve_implementation_evidence(monkeypatch):
    rt, *_ = successful_runtime(monkeypatch)
    implementation = copy.deepcopy(rt.workspace["implementationValidation"])
    rt.scope = rt.new_scope("flow-v2/review/0", "david")
    changed_checks = checks()
    changed_checks[0]["name"] = "independent baseline observation"
    rt.operation("set_review_checks", {"checks": changed_checks})
    assert rt.workspace["implementationValidation"] == implementation
    assert current_build(rt.workspace)
    assert completion_status(rt.workspace)["missing"] == [
        "independentValidation",
        "independent_review",
    ]
    rt.operation("validate_preview", {})
    rt.operation("record_review", review_args())
    assert completion_status(rt.workspace)["ready"]


def test_recovery_after_candidate_commit_reuses_completed_stage_operations(monkeypatch):
    rt, _ = runtime()
    wire_stages(monkeypatch, rt)
    original = rt.durable.run
    interrupted = [False]

    def stop_after_commit(name, function):
        result = original(name, function)
        if name == "flow-v2/candidate/000000" and not interrupted[0]:
            interrupted[0] = True
            raise CancelledError()
        return result

    monkeypatch.setattr(rt.durable, "run", stop_after_commit)
    with pytest.raises(CancelledError):
        rt.run_workflow()
    candidate = copy.deepcopy(rt.durable.values["flow-v2/candidate/000000"])
    completed_tools = [name for name in rt.durable.order if "/tool-" in name]
    resumed, _ = runtime(durable=rt.durable)
    wire_stages(monkeypatch, resumed)
    gates = wire_gates(monkeypatch, resumed)
    result = resumed.run_workflow()
    assert result["source"] == candidate["source"]
    assert gates == ["compile", "browser", "browser"]
    assert all(rt.durable.order.count(name) == 1 for name in completed_tools)


def test_cancellation_during_compile_preserves_source_and_fences_artifact(monkeypatch):
    rt, _ = runtime()
    wire_stages(monkeypatch, rt)

    def compile_then_cancel(source, *_):
        rt.cancelled = lambda: True
        return {"sourceHash": source_hash(source), "html": "<!doctype html><html></html>"}

    monkeypatch.setattr("formlane.agents.compile_project", compile_then_cancel)
    with pytest.raises(RuntimeAbort) as error:
        rt.run_workflow()
    assert isinstance(error.value.cause, CancelledError)
    assert rt.durable.values["flow-v2/candidate/000000"]["source"]
    assert "flow-v2/candidate/000001" not in rt.durable.values
    assert current_build(rt.workspace) is None
