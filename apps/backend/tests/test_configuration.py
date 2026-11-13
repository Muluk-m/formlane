import shutil
import threading
from importlib.resources import files

import pytest
import yaml
from sqlalchemy import event
from sqlalchemy.engine import Engine
from test_flow_equivalence import observe_scenario

from formlane.delivery import configuration
from formlane.settings import Settings
from formlane.worker import run_worker


@pytest.fixture
def configuration_resources(tmp_path, monkeypatch):
    root = tmp_path / "resources"
    shutil.copytree(files("formlane.delivery").joinpath("resources"), root)
    monkeypatch.setattr(configuration, "files", lambda package: tmp_path)
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://unused@configuration.invalid/unused")
    configuration.initialize_configuration.cache_clear()
    yield root
    configuration.initialize_configuration.cache_clear()


def rewrite(root, change):
    path = root / "stages.yaml"
    data = yaml.safe_load(path.read_text())
    change(data)
    path.write_text(yaml.safe_dump(data))


def start_worker():
    shutdown = threading.Event()
    shutdown.set()
    run_worker(Settings(worker_enabled=True), shutdown)


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("stages", "reviewer"), None),
        (("stages", "coordinator"), None),
        (("stages", "coordinator", "tool_set"), "unknown"),
        (("stages", "unknown"), {}),
        (("personas", "bob"), None),
        (("personas", "unknown"), {}),
        (("stages", "builder", "persona"), "unknown"),
        (("stages", "builder", "tool_set"), "unknown"),
        (("stages", "builder", "tool_set"), None),
        (("stages", "builder", "tool_budgets"), {"unknown": 1}),
        (("stages", "builder", "tool_budgets"), {"choose_route": 1}),
        (("stages", "builder", "tool_budgets"), {"inspect_preview": 0}),
        (("stages", "builder", "tool_budgets"), {"inspect_preview": True}),
        (("stages", "builder", "decide_now"), ""),
        (("stages", "builder", "reasoning_effort"), "none"),
        (("stages", "builder", "max_iterations"), 0),
        (("stages", "builder", "max_iterations"), -1),
        (("stages", "builder", "max_iterations"), "30"),
        (("stages", "builder", "max_iterations"), True),
        (("stages", "builder", "max_iterations"), 1.5),
        (("stages", "builder", "contracts"), ["missing.txt"]),
        (("personas", "alex", "goal"), "missing.txt"),
        (("personas", "alex", "backstory"), ["missing.txt"]),
        (("personas", "alex", "display_name"), 123),
        (("personas", "alex", "role"), ""),
        (("personas", "alex", "backstory"), []),
        (("shared", "team"), "../outside.txt"),
        (("shared", "followup"), "missing.txt"),
    ],
)
def test_worker_rejects_invalid_configuration_before_accessing_runs(
    configuration_resources, path, value
):
    def change(data):
        for key in path[:-1]:
            data = data[key]
        if value is None:
            del data[path[-1]]
        else:
            data[path[-1]] = value

    rewrite(configuration_resources, change)
    connections = []

    def reject_connection(*args):
        connections.append(True)
        raise AssertionError("Invalid configuration reached the database")

    event.listen(Engine, "do_connect", reject_connection)
    try:
        with pytest.raises(configuration.ConfigurationError):
            start_worker()
    finally:
        event.remove(Engine, "do_connect", reject_connection)
    assert connections == []


def test_configuration_is_loaded_once_and_immutable(configuration_resources):
    configured = configuration.initialize_configuration()
    stage = configuration.get_stage_config("builder")
    (configuration_resources / "stages.yaml").unlink()
    assert configuration.initialize_configuration() is configured
    assert configuration.get_stage_config("builder") is stage
    with pytest.raises(TypeError):
        stage.tool_budgets["inspect_preview"] = 100
    with pytest.raises(AttributeError):
        stage.max_iterations = 100


def test_coordinator_has_mike_and_its_own_decision_contract(configuration_resources):
    configured = configuration.initialize_configuration()
    assert set(configured.stages) == {
        "router", "coordinator", "planner", "builder", "repair", "quick_edit", "reviewer",
    }
    stage = configuration.get_stage_config("coordinator")
    assert stage.persona == "mike"
    assert stage.reasoning_effort == "medium"
    assert stage.max_iterations == 8
    assert stage.tool_set == "coordinator"


@pytest.mark.parametrize("contents", ["stages: [", "shared: {}\nshared: {}", "[]"])
def test_worker_rejects_malformed_yaml(configuration_resources, contents):
    (configuration_resources / "stages.yaml").write_text(contents)
    with pytest.raises(configuration.ConfigurationError):
        start_worker()


@pytest.mark.parametrize("resource", ["stages.yaml", "checks.txt", "coordinator.txt"])
def test_worker_rejects_missing_packaged_resources(configuration_resources, resource):
    (configuration_resources / resource).unlink()
    with pytest.raises(configuration.ConfigurationError):
        start_worker()


def test_worker_rejects_empty_contract(configuration_resources):
    (configuration_resources / "checks.txt").write_text(" \n")
    with pytest.raises(configuration.ConfigurationError):
        start_worker()


def test_all_packaged_stage_resources_load_before_polling(configuration_resources):
    start_worker()
    (configuration_resources / "stages.yaml").unlink()
    start_worker()


@pytest.mark.parametrize("lookup", [configuration.get_stage_config, configuration.get_persona_config])
def test_unknown_runtime_references_fail_explicitly(configuration_resources, lookup):
    with pytest.raises(configuration.ConfigurationError, match="Unknown"):
        lookup("unknown")


@pytest.mark.parametrize("scenario", ["initial_build", "quick_edit"])
def test_configured_mike_name_reaches_run_lifecycle(configuration_resources, monkeypatch, scenario):
    rewrite(
        configuration_resources,
        lambda data: data["personas"]["mike"].update(display_name="Morgan"),
    )
    observed = observe_scenario(scenario, monkeypatch)
    attempt = observed["attempts"][0]
    assert attempt["failure"] is None
    assert attempt["result"] is not None
    events = attempt["events"]
    assert events[0]["type"] == "agent_start"
    assert events[-1]["type"] == "agent_end"
    for lifecycle_event in (events[0], events[-1]):
        assert lifecycle_event["data"]["id"] == "mike"
        assert lifecycle_event["data"]["name"] == "Morgan"
