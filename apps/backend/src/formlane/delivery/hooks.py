"""Execution-scoped CrewAI budget policy; workspace owns all acceptance evidence."""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager

from crewai.hooks import InterceptionPoint
from crewai.hooks.dispatch import scoped_hooks
from crewai.hooks.tool_hooks import ToolCallHookContext
from pydantic import ValidationError

from .configuration import get_stage_config
from .errors import RuntimeAbort
from .workspace import Runtime


@contextmanager
def stage_tool_hooks(runtime: Runtime, kind: str) -> Iterator[None]:
    """Count native calls, including durable replay, only for this stage lifetime."""
    policy = get_stage_config(kind)
    uses: dict[str, int] = {}
    blocked: tuple[str, dict, str] | None = None

    def before(context: ToolCallHookContext) -> bool | None:
        nonlocal blocked
        blocked = None
        try:
            runtime.check()
            limit = policy.tool_budgets.get(context.tool_name)
            if limit is None or context.tool is None:
                return None
            try:
                # Native hooks precede the tool's Pydantic validation. Leave invalid
                # arguments to that path, even when the valid-call budget is spent.
                context.tool.args_schema.model_validate(context.tool_input)
            except ValidationError:
                return None
            used = uses.get(context.tool_name, 0)
            if used >= limit:
                reason = json.dumps({
                    "error": f"{context.tool_name} budget of {limit} for this stage is used up. "
                    f"{policy.decide_now}"
                })
                blocked = (context.tool_name, context.tool_input, reason)
                return False
            # Cached durable tools still pass through the native executor, rebuilding
            # exactly the same allowance without allocating a denied durable step.
            uses[context.tool_name] = used + 1
            return None
        except Exception as error:
            # The SDK swallows ordinary hook exceptions. Authority failures must
            # unwind the stage, including cancellation before a denied call.
            raise RuntimeAbort(error) from None

    def after(context: ToolCallHookContext) -> str | None:
        nonlocal blocked
        denial, blocked = blocked, None
        if (
            denial is not None
            and context.tool_name == denial[0]
            and context.tool_input is denial[1]
        ):
            # PRE's reason is discarded by CrewAI. POST also runs for blocked calls
            # and replaces the generic SDK response with our frozen JSON response.
            return denial[2]
        return None

    # The official ContextVar registry restores its prior token on every exit.
    # SourceExecutor keeps PRE/tool/POST ordered; no global per-run closures leak.
    with scoped_hooks({
        InterceptionPoint.PRE_TOOL_CALL: [before],
        InterceptionPoint.POST_TOOL_CALL: [after],
    }):
        yield
