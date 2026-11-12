import copy
import os
from types import SimpleNamespace

os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CREWAI_TRACING_ENABLED"] = "false"

import pytest

from formlane.agents import (
    HarnessFailure,
    Runtime,
    SourceExecutor,
    apply_file_edits,
    checks_hash,
    completion_status,
    current_build,
    execute_harness,
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


def runtime(previous=None):
    events = []
    result = Runtime(
        SimpleNamespace(),
        {
            "runId": "run",
            "projectId": "project",
            "idea": "obsolete +1",
            "request": "Change color",
            "previousSource": previous,
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
    state["review"] = {
        **state["build"],
        "accepted": True,
        "findings": "Verified",
        "checksHash": checks_hash(state["checks"]),
    }
    return rt


def test_completion_requires_each_exact_evidence_stamp():
    assert completion_status(accepted_workspace().workspace)["ready"]
    mutations = [
        lambda s: s.update(html=s["html"] + "changed"),
        lambda s: s["source"]["files"].update({"extra.js": "console.log(1)"}),
        lambda s: s.update(validatedBy="alex"),
        lambda s: s["implementationValidation"].update(sourceHash="stale"),
        lambda s: s["review"].update(checksHash="stale"),
        lambda s: s["review"].update(accepted=False),
        lambda s: s["report"].update(artifactHash="stale"),
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
    qa = {tool.name for tool in rt.tools("david")}
    assert qa == {
        "read_workspace",
        "read_review_files",
        "set_acceptance_checks",
        "validate_preview",
        "record_review",
    }
    assert {tool.name for tool in rt.tools("emma")} == {"read_workspace", "read_previous_file"}
    assert not any(
        "shell" in tool.name for role in ("emma", "bob", "alex", "david") for tool in rt.tools(role)
    )
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
    assert rt.workspace["implementationPasses"] == 1


def test_review_requires_own_browser_and_changed_file_inspection():
    rt = accepted_workspace()
    rt.workspace["source"]["files"]["index.html"] += "<!-- requested change -->"
    rt.workspace["build"]["sourceHash"] = source_hash(rt.workspace["source"])
    args = {"accepted": True, "findings": "Accepted"}
    with pytest.raises(ValueError, match="inspection"):
        rt.operation("record_review", args)
    rt.operation("read_review_files", {"paths": ["index.html"]})
    assert rt.operation("record_review", args)["accepted"]
    rt.workspace["validatedBy"] = "alex"
    with pytest.raises(ValueError):
        rt.operation("record_review", args)


def test_tool_checkpoint_recovers_source_without_repeating_mutation():
    rt, events = runtime(create_source("vanilla"))
    rt.scope = rt.new_scope("delegation", "alex")
    tools = {tool.name: tool for tool in rt.tools("alex")}
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


def test_native_hierarchical_crew_construction_and_acceptance_guard(monkeypatch):
    captured = {}

    def kickoff(crew):
        captured["crew"] = crew
        from formlane.agents import HarnessFailure

        raise HarnessFailure("validation")

    monkeypatch.setattr("formlane.agents.Crew.kickoff", kickoff)
    settings = SimpleNamespace(
        openai_api_key="test-only", endpoint="http://127.0.0.1:1/v1", model="test"
    )
    with pytest.raises(HarnessFailure):
        execute_harness(
            settings,
            {
                "runId": "run",
                "projectId": "project",
                "idea": "Counter",
                "request": "Counter",
                "previousSource": None,
            },
            Checkpoints(),
            lambda *_: None,
            lambda: False,
        )
    crew = captured["crew"]
    assert crew.process.value == "hierarchical"
    assert crew.manager_agent.role == "Mike"
    assert crew.manager_agent.allow_delegation
    assert {agent.role for agent in crew.agents} == {"Emma", "Bob", "Alex", "David"}
    assert all(not agent.allow_delegation for agent in crew.agents)
    assert not crew.cache and not crew.memory


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
    rt.settings.browser_executable = os.environ.get("BROWSER_EXECUTABLE_PATH")
    rt.scope = rt.new_scope("independent-review", "david")
    report = rt.operation("validate_preview", {})
    assert report["valid"], report["issues"]
    review = rt.operation(
        "record_review", {"accepted": True, "findings": "Independent browser checks passed."}
    )
    assert review["completion"]["ready"]


def test_rejected_package_write_is_atomic_and_emits_no_saved_file():
    rt, events = runtime(create_source("vanilla"))
    rt.scope = rt.new_scope("alex", "alex")
    initial = copy.deepcopy(rt.workspace)
    tool = next(tool for tool in rt.tools("alex") if tool.name == "write_file")
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
