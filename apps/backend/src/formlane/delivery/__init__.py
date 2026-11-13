"""Public entry point for code-orchestrated, durable application delivery."""

import os
from typing import Any, Callable

# Set before importing CrewAI; neither prompts nor provider credentials leave via telemetry.
os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CREWAI_TRACING_ENABLED"] = "false"

from ._crewai import ObservedOpenAI
from .configuration import get_persona_config
from .errors import HarnessFailure
from .flow import DeliveryFlow
from .stages import Delivery
from .workspace import Runtime


def execute_harness(
    settings: Any, context: dict, durable: Any, emit: Callable, cancelled: Callable
) -> dict:
    key = settings.openai_api_key
    if hasattr(key, "get_secret_value"):
        key = key.get_secret_value()
    if not key:
        raise HarnessFailure("provider")
    runtime = Runtime(settings, context, durable, emit, cancelled)
    runtime.check()
    llms: list[ObservedOpenAI] = []

    def model(effort: str | None = None) -> ObservedOpenAI:
        llm = ObservedOpenAI(
            model=settings.model,
            reasoning_effort=effort,
            api_key=key,
            base_url=settings.endpoint,
            custom_openai=bool(settings.endpoint),
            api="completions",
            stream=True,
            timeout=120.0,
            max_retries=0,
            additional_params={"parallel_tool_calls": False},
        ).bind(runtime)
        llms.append(llm)
        return llm

    flow = DeliveryFlow(Delivery(runtime, model))
    name = get_persona_config("mike").display_name
    try:
        with runtime.scoped("run", "mike"):
            emit("agent_start", {"id": "mike", "name": name})
        result = flow.execute()
        runtime.check()
        with runtime.scoped("run-end", "mike"):
            emit("agent_end", {"id": "mike", "name": name})
        return result
    finally:
        for llm in llms:
            llm.close()
