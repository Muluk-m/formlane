"""Validated, immutable delivery configuration loaded before worker polling."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from functools import cache
from importlib.resources import files
from types import MappingProxyType
from typing import Annotated, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError

STAGE_KINDS = frozenset({"router", "planner", "builder", "quick_edit", "repair", "reviewer"})
PERSONAS = frozenset({"mike", "emma", "bob", "alex", "david"})
Text = Annotated[str, Field(min_length=1, pattern=r"\S")]
PositiveLimit = Annotated[int, Field(gt=0)]


class ConfigurationError(ValueError):
    """The packaged delivery configuration cannot safely serve Runs."""


class _Data(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class _PersonaData(_Data):
    display_name: Text
    role: Text
    goal: Text
    backstory: Annotated[list[Text], Field(min_length=1)]


class _StageData(_Data):
    persona: Text
    contracts: list[Text]
    reasoning_effort: Literal["low", "medium", "high"]
    max_iterations: PositiveLimit
    tool_set: Text
    tool_budgets: dict[Text, PositiveLimit]
    decide_now: str


class _SharedData(_Data):
    team: Text
    followup: Text


class _ConfigurationData(_Data):
    shared: _SharedData
    personas: dict[Text, _PersonaData]
    stages: dict[Text, _StageData]


class _UniqueLoader(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        result = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if not isinstance(key, str) or key in result:
                raise ConfigurationError("Configuration keys must be unique strings")
            result[key] = self.construct_object(value_node, deep=deep)
        return result


@dataclass(frozen=True)
class PersonaConfig:
    display_name: str
    role: str
    goal: str
    backstory: str


@dataclass(frozen=True)
class StageConfig:
    persona: str
    display_name: str
    role: str
    goal: str
    backstory: str
    followup_backstory: str
    reasoning_effort: str
    max_iterations: int
    tool_set: str
    tool_budgets: Mapping[str, int]
    decide_now: str


@dataclass(frozen=True)
class Configuration:
    personas: Mapping[str, PersonaConfig]
    stages: Mapping[str, StageConfig]


def _require_names(actual: Mapping, expected: frozenset[str], label: str) -> None:
    missing, unknown = expected - actual.keys(), actual.keys() - expected
    if missing or unknown:
        raise ConfigurationError(
            f"Invalid {label}: missing={sorted(missing)}, unknown={sorted(unknown)}"
        )


@cache
def initialize_configuration() -> Configuration:
    """Read every referenced resource and validate all stages once per process."""
    # Import only when initializing: tools consumes this module's validated selection.
    from .tools import STAGE_TOOLSETS

    root = files("formlane.delivery").joinpath("resources")
    try:
        data = _ConfigurationData.model_validate(
            yaml.load(root.joinpath("stages.yaml").read_text(encoding="utf-8"), Loader=_UniqueLoader)
        )
    except (OSError, UnicodeError, yaml.YAMLError, ValidationError) as error:
        raise ConfigurationError(f"Invalid delivery configuration: {error}") from error
    _require_names(data.stages, STAGE_KINDS, "stages")
    _require_names(data.personas, PERSONAS, "personas")
    resources: dict[str, str] = {}

    def resource(name: str) -> str:
        if name not in resources:
            if not name.endswith(".txt") or "/" in name or "\\" in name or name.startswith("."):
                raise ConfigurationError(f"Invalid text resource reference: {name!r}")
            try:
                text = root.joinpath(name).read_text(encoding="utf-8")
            except (OSError, UnicodeError) as error:
                raise ConfigurationError(f"Cannot read text resource {name!r}") from error
            if not text.strip():
                raise ConfigurationError(f"Empty text resource: {name!r}")
            resources[name] = text
        return resources[name]

    team, followup = resource(data.shared.team), resource(data.shared.followup)
    personas = {
        name: PersonaConfig(
            display_name=persona.display_name,
            role=persona.role,
            goal=resource(persona.goal),
            backstory="\n\n".join(resource(ref) for ref in persona.backstory),
        )
        for name, persona in data.personas.items()
    }
    stages = {}
    for kind, stage in data.stages.items():
        if stage.persona not in personas:
            raise ConfigurationError(f"Unknown persona {stage.persona!r} for stage {kind!r}")
        if stage.tool_set not in STAGE_TOOLSETS:
            raise ConfigurationError(f"Unknown tool set {stage.tool_set!r} for stage {kind!r}")
        variants = STAGE_TOOLSETS[stage.tool_set]
        for variant in variants:
            names = {tool.model_fields["name"].default for tool in variant}
            unknown = stage.tool_budgets.keys() - names
            if unknown:
                raise ConfigurationError(f"Unknown budget tools for stage {kind!r}: {sorted(unknown)}")
        if stage.tool_budgets and not stage.decide_now.strip():
            raise ConfigurationError(f"Stage {kind!r} requires a decide_now instruction")
        persona = personas[stage.persona]
        instructions = "\n\n".join(
            [persona.backstory, *(resource(ref) for ref in stage.contracts)]
        )
        stages[kind] = StageConfig(
            persona=stage.persona,
            display_name=persona.display_name,
            role=persona.role,
            goal=persona.goal,
            backstory=f"{team}\n\n{instructions}",
            followup_backstory=f"{team}\n\n{followup}\n\n{instructions}",
            reasoning_effort=stage.reasoning_effort,
            max_iterations=stage.max_iterations,
            tool_set=stage.tool_set,
            tool_budgets=MappingProxyType(dict(stage.tool_budgets)),
            decide_now=stage.decide_now,
        )
    return Configuration(MappingProxyType(personas), MappingProxyType(stages))


def get_stage_config(kind: str) -> StageConfig:
    try:
        return initialize_configuration().stages[kind]
    except KeyError:
        raise ConfigurationError(f"Unknown stage: {kind!r}") from None


def get_persona_config(persona: str) -> PersonaConfig:
    try:
        return initialize_configuration().personas[persona]
    except KeyError:
        raise ConfigurationError(f"Unknown persona: {persona!r}") from None
