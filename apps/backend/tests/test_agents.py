import copy
import os
from contextlib import nullcontext
from types import SimpleNamespace

os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CREWAI_TRACING_ENABLED"] = "false"

import pytest

from formlane.agents import (
    MAX_REVIEW_REPAIRS,
    MAX_VERIFY_REPAIRS,
    SMOKE_CHECK_NAME,
    Delivery,
    DeliveryFlow,
    HarnessFailure,
    Runtime,
    SourceExecutor,
    apply_file_edits,
    checks_hash,
    completion_status,
    current_build,
    execute_harness,
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
    screenshots = [
        {
            **state["build"],
            "sha256": "a" * 64,
            "mimeType": "image/jpeg",
            "viewport": {"width": 1280, "height": 720},
        }
    ]
    state["visualReview"] = {
        **state["build"],
        "modelStep": "review/llm-1",
        "screenshots": screenshots,
    }
    state["review"] = {
        **state["build"],
        "accepted": True,
        "findings": "Verified",
        "checksHash": checks_hash(state["checks"]),
        "visualEvidence": copy.deepcopy(screenshots),
    }
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
        lambda s: s.update(visualReview=None),
        lambda s: s["visualReview"].update(artifactHash="stale"),
        lambda s: s["visualReview"]["screenshots"][0].update(sourceHash="stale"),
        lambda s: s["visualReview"].update(screenshots=[]),
        lambda s: s["review"].update(visualEvidence=[]),
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
    assert rt.operation("read_previous_file", {"path": "index.html"})["content"] == baseline
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
    qa = {tool.name for tool in rt.tools("reviewer")}
    assert qa == {
        "read_workspace",
        "read_review_files",
        "search_files",
        "inspect_preview",
        "set_acceptance_checks",
        "validate_preview",
        "record_review",
    }
    assert {tool.name for tool in rt.tools("router")} == {"choose_route"}
    assert {tool.name for tool in rt.tools("planner")} == {
        "read_workspace",
        "read_previous_file",
        "read_file",
        "submit_plan",
    }
    builder = {tool.name for tool in rt.tools("builder")}
    assert "set_acceptance_checks" not in builder
    assert {"validate_preview", "inspect_preview", "search_files"} <= builder
    assert "set_acceptance_checks" in {tool.name for tool in rt.tools("quick_edit")}
    assert not any(
        "shell" in tool.name
        for kind in ("router", "planner", "builder", "quick_edit", "reviewer")
        for tool in rt.tools(kind)
    )
    fresh, _ = runtime()
    assert {tool.name for tool in fresh.tools("planner")} == {"read_workspace", "submit_plan"}
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
    assert rt.workspace["visualReview"] is None
    assert rt.scope["images"] == []


def test_review_requires_own_browser_and_changed_file_inspection():
    rt = accepted_workspace()
    rt.workspace["source"]["files"]["index.html"] += "<!-- requested change -->"
    rt.workspace["build"]["sourceHash"] = source_hash(rt.workspace["source"])
    rt.workspace["visualReview"]["sourceHash"] = rt.workspace["build"]["sourceHash"]
    rt.workspace["visualReview"]["screenshots"][0]["sourceHash"] = rt.workspace["build"][
        "sourceHash"
    ]
    args = {"accepted": True, "findings": "Accepted"}
    with pytest.raises(ValueError, match="inspection"):
        rt.operation("record_review", args)
    rt.operation("read_review_files", {"paths": ["index.html"]})
    assert rt.operation("record_review", args)["accepted"]
    rt.workspace["independentValidation"] = None
    with pytest.raises(ValueError):
        rt.operation("record_review", args)


def test_tool_checkpoint_recovers_source_without_repeating_mutation():
    rt, events = runtime(create_source("vanilla"))
    rt.scope = rt.new_scope("delegation", "alex")
    tools = {tool.name: tool for tool in rt.tools("builder")}
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


def test_verification_repairs_are_bounded_and_failures_reach_review():
    rt, _ = runtime(create_source("vanilla"))
    delivery = Delivery(rt, None)
    checks, repairs = [], []
    delivery.check_candidate = lambda key: checks.append(key) or {"valid": False, "issues": ["x"]}
    delivery.repair = lambda key, issues: repairs.append(key)
    delivery.verify()
    assert len(checks) == MAX_VERIFY_REPAIRS + 1
    assert len(repairs) == MAX_VERIFY_REPAIRS


def test_unaccepted_review_repairs_once_then_fails_validation():
    rt, _ = runtime(create_source("vanilla"))
    delivery = Delivery(rt, None)
    stages, repairs = [], []

    def review_stage(key, kind, *args):
        stages.append(key)
        rt.workspace["review"] = {"accepted": False, "findings": "Counter does not reset."}

    delivery.stage = review_stage
    delivery.check_candidate = lambda key: {"valid": True}
    delivery.repair = lambda key, issues: repairs.append(issues)
    with pytest.raises(HarnessFailure) as error:
        delivery.review()
    assert error.value.code == "validation"
    assert len(stages) == MAX_REVIEW_REPAIRS + 1
    assert repairs == [["Counter does not reset."]] * MAX_REVIEW_REPAIRS


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
    output = rt.invoke("submit_plan", plan)
    assert output["template"] == "vanilla" and output["checks"] == 3
    assert rt.workspace["checks"][0]["name"] == SMOKE_CHECK_NAME
    assert "A1. Click increments" in rt.workspace["brief"]
    assert any(kind == "project_initialized" for kind, _ in events)
    assert "error" in rt.invoke("submit_plan", plan)
    assert rt.invoke("submit_candidate", {"summary": "Done"})["error"].startswith("Build")


def test_independent_review_checks_preserve_current_implementation_evidence():
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
    rt.operation("set_acceptance_checks", {"checks": checks})
    assert current_build(rt.workspace) is not None
    assert rt.workspace["implementationValidation"] == rt.workspace["build"]
    assert rt.workspace["report"] is None
    assert rt.workspace["review"] is None
    assert set(completion_status(rt.workspace)["missing"]) == {
        "david_validation",
        "david_acceptance",
    }
    assert rt.workspace["checks"][0]["name"] == SMOKE_CHECK_NAME
    rt.settings.browser_executable = os.environ.get("BROWSER_EXECUTABLE_PATH")
    rt.scope = rt.new_scope("independent-review", "david")
    report = rt.operation("validate_preview", {})
    assert report["valid"], report["issues"]
    review = rt.operation(
        "record_review", {"accepted": True, "findings": "Independent browser checks passed."}
    )
    assert review["completion"]["ready"]
    # Re-running implementation evidence on unchanged source keeps the independent verdict.
    rt.scope = rt.new_scope("revalidate", "alex")
    assert rt.operation("validate_preview", {})["valid"]
    assert completion_status(rt.workspace)["ready"]


def test_rejected_package_write_is_atomic_and_emits_no_saved_file():
    rt, events = runtime(create_source("vanilla"))
    rt.scope = rt.new_scope("alex", "alex")
    initial = copy.deepcopy(rt.workspace)
    tool = next(tool for tool in rt.tools("builder") if tool.name == "write_file")
    output = tool.run(path="package.json", content='{"scripts":{"build":"arbitrary-code"}}')
    assert "error" in output
    assert rt.workspace == initial
    assert not any(kind == "file_saved" for kind, _ in events)


def test_browser_checks_have_structured_native_function_schema():
    from formlane.agents import ChecksArgs

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
    assert rt.operation("submit_candidate", {"summary": "Done", "check_defects": []})["submitted"]
    rt = built_runtime()
    rt.workspace["implementationValidation"] = rt.workspace["report"] = None
    with pytest.raises(ValueError, match="validate_preview"):
        rt.operation("submit_candidate", {"summary": "Done", "check_defects": []})
    rt.workspace["report"] = {
        "valid": False,
        "artifactHash": rt.workspace["build"]["artifactHash"],
        "issues": ["wrong"],
        "checks": [{"name": "one", "passed": True}, {"name": "two", "passed": False}],
    }
    with pytest.raises(ValueError, match="two"):
        rt.operation("submit_candidate", {"summary": "Done", "check_defects": []})
    rt.operation("submit_candidate", {"summary": "Check two is wrong", "check_defects": ["two"]})
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


def test_stage_tool_budgets_force_a_decision():
    rt = accepted_workspace()
    rt.scope = rt.new_scope("review", "david")
    calls = []
    rt.invoke = lambda name, args: calls.append(name) or {"ok": True}
    inspect = next(tool for tool in rt.tools("reviewer") if tool.name == "inspect_preview")
    outputs = [inspect.run(selector="body") for _ in range(7)]
    assert len(calls) == 6
    assert "record_review now" in outputs[-1] and "budget of 6" in outputs[-1]
    rt.scope = rt.new_scope("review-1", "david")
    assert "budget" not in inspect.run(selector="body")


def test_inspection_alone_and_other_roles_cannot_establish_visual_acceptance(monkeypatch):
    rt = accepted_workspace()
    rt.workspace.update(review=None, visualReview=None)
    rt.scope = rt.new_scope("review", "david")
    image = {
        **rt.workspace["build"],
        "sha256": "a" * 64,
        "mimeType": "image/jpeg",
        "viewport": {"width": 375, "height": 812},
        "data": "private-image-bytes",
    }
    monkeypatch.setattr("formlane.agents.inspect_artifact", lambda *args: {"screenshot": image})
    observed = rt.invoke("inspect_preview", {})
    assert "data" not in observed["screenshot"]
    assert rt.workspace["visualReview"] is None
    verdict = {"accepted": True, "findings": "Looks correct"}
    with pytest.raises(ValueError, match="screenshots"):
        rt.operation("record_review", verdict)
    _, evidence = rt.model_messages("Review")
    rt.scope["role"] = "alex"
    rt.record_visual_delivery("alex/llm-0", evidence)
    assert rt.workspace["visualReview"] is None
    rt.scope["role"] = "david"
    rt.record_visual_delivery("review/llm-0", evidence)
    assert rt.operation("record_review", verdict)["completion"]["ready"]
    # A screenshot receipt cannot substitute for independent behavior validation.
    rt.workspace["independentValidation"] = None
    with pytest.raises(ValueError, match="validation"):
        rt.operation("record_review", verdict)


def test_visual_images_are_scoped_and_source_changes_remove_delivery():
    rt = accepted_workspace()
    rt.scope = rt.new_scope("review", "david")
    image = {
        **rt.workspace["build"],
        "sha256": "a" * 64,
        "mimeType": "image/jpeg",
        "viewport": {"width": 1280, "height": 720},
        "data": "private-image-bytes",
    }
    rt.scope["images"].append(image)
    history = [{"role": "user", "content": "Review"}]
    messages, evidence = rt.model_messages(history)
    assert len(messages) == 2 and len(history) == 1
    assert evidence and "data" not in evidence[0]
    with rt.scoped("different-review", "david"):
        assert rt.model_messages(history) == (history, [])
    source = copy.deepcopy(rt.workspace["source"])
    source["files"]["extra.js"] = "const updated = 1"
    rt.invalidate(source)
    assert rt.model_messages(history) == (history, [])
    assert rt.scope["images"] == []
    rt.workspace.update(
        html="new artifact",
        build={
            "sourceHash": source_hash(source),
            "artifactHash": artifact_hash("new artifact"),
            "revision": rt.workspace["revision"],
        },
    )
    rt.scope["images"].append(image)
    assert rt.model_messages(history) == (history, [])
    rt.record_visual_delivery("review/llm-1", evidence)
    assert rt.workspace["visualReview"] is None
    assert "david_visual_review" in completion_status(rt.workspace)["missing"]


def test_rebuild_clears_visual_images_and_acceptance(monkeypatch):
    rt = accepted_workspace()
    rt.scope = rt.new_scope("build", "alex")
    rt.scope["images"] = [{**rt.workspace["build"], "data": "private-image-bytes"}]
    html = rt.workspace["html"]
    monkeypatch.setattr(
        "formlane.agents.compile_project",
        lambda source, *_: {
            "sourceHash": source_hash(source),
            "html": html,
        },
    )
    assert rt.invoke("build_project", {})["ok"]
    assert rt.workspace["visualReview"] is None
    assert rt.scope["images"] == []


def test_initial_stages_receive_workspace_and_only_new_builder_gets_template_files():
    rt, _ = runtime()
    delivery = Delivery(rt, None)
    tasks = []

    def stage(key, kind, label, task, message):
        tasks.append((kind, task))
        if kind == "planner":
            rt.workspace.update(plan={"brief": "Plan"}, source=create_source("vanilla"))

    delivery.stage = stage
    delivery.plan()
    assert tasks[0][0] == "planner"
    assert tasks[0][1]["workspace"]["files"] == []
    assert "templateFiles" not in tasks[0][1]
    delivery.implement("builder", "build", "Build")
    builder = tasks[-1][1]
    assert builder["workspace"] == rt.workspace_info()
    assert builder["templateFiles"] == rt.workspace["source"]["files"]
    assert builder["templateFiles"] is not rt.workspace["source"]["files"]
    delivery.implement("repair", "repair-0", "Repair", {"failures": ["broken"]})
    assert "workspace" not in tasks[-1][1] and "templateFiles" not in tasks[-1][1]
    assert tasks[-1][1]["evidence"] == {"failures": ["broken"]}
    follow_up, _ = runtime(create_source("vanilla"))
    iteration = Delivery(follow_up, None)
    iteration.stage = stage
    iteration.implement("quick_edit", "edit", "Edit")
    assert tasks[-1][1]["workspace"] == follow_up.workspace_info()
    assert "templateFiles" not in tasks[-1][1]
    iteration.implement("builder", "build", "Build")
    assert "templateFiles" not in tasks[-1][1]
