"""Stage orchestration and coordinator-directed delivery iterations."""

from __future__ import annotations

import json
import time
from typing import Any, Callable

from crewai import Agent, Task

from ._crewai import ObservedOpenAI, SourceExecutor
from .configuration import get_persona_config, get_stage_config
from .errors import HarnessFailure, RuntimeAbort
from .hooks import stage_tool_hooks
from .selection import summary
from .tools import tools_for_stage
from .workspace import FLOW_VERSION, Runtime, completion_status, current_build


class Delivery:
    """Stage implementations; DeliveryFlow decides their order."""

    def __init__(self, runtime: Runtime, model: Callable[[str | None], ObservedOpenAI]):
        self.rt, self.model = runtime, model

    @property
    def workspace(self) -> dict:
        return self.rt.workspace

    def agent(self, kind: str) -> Agent:
        config = get_stage_config(kind)
        tools = tools_for_stage(self.rt, kind)
        return Agent(
            role=config.role,
            goal=config.goal,
            backstory=config.followup_backstory if self.rt.previous else config.backstory,
            llm=self.model(config.reasoning_effort),
            tools=tools,
            allow_delegation=False,
            allow_code_execution=False,
            max_iter=config.max_iterations,
            max_retry_limit=0,
            cache=False,
            verbose=False,
            checkpoint=False,
            executor_class=SourceExecutor,
        )

    def say(self, persona: str, message_id: str, content: str) -> None:
        self.rt.emit("message_start", {"id": message_id, "role": "agent", "agent": persona})
        self.rt.emit(
            "message_done",
            {
                "id": message_id,
                "role": "agent",
                "agent": persona,
                "content": content,
                "createdAt": int(time.time() * 1000),
            },
        )

    def stage(self, key: str, kind: str, label: str, task: dict, message: Callable[[str], str]):
        config = get_stage_config(kind)
        persona = config.persona
        with self.rt.scoped(key, persona) as scope:
            visible = persona != "mike"
            if visible:
                self.rt.emit(
                    "tool_start",
                    {
                        "id": scope["path"],
                        "name": f"delegate_{persona}",
                        "agent": "mike",
                        "childAgent": persona,
                        "input": label,
                    },
                )
                self.rt.emit(
                    "agent_start", {"id": persona, "name": config.display_name, "task": label}
                )
            if kind == "reviewer" and self.rt.selection:
                task = {**task, "frozenSelection": self.rt.read_selection({})}
            agent = self.agent(kind)
            native = Task(
                description=json.dumps(
                    {
                        "stage": label,
                        **task,
                        "selection": summary(self.rt.selection),
                        "workspace": self.rt.workspace_info(),
                    },
                    ensure_ascii=False,
                ),
                expected_output="Call your terminal tool with the stage result.",
                agent=agent,
            )
            try:
                with stage_tool_hooks(self.rt, kind):
                    output = str(agent.execute_task(native, None, agent.tools))
            except RuntimeAbort:
                raise
            except Exception as error:
                raise RuntimeAbort(error) from None
            self.rt.check()
            content = message(output)
            if visible:
                self.say(persona, scope["message_id"], content)
                self.rt.emit("agent_end", {"id": persona, "name": config.display_name})
                self.rt.emit(
                    "tool_end",
                    {
                        "id": scope["path"],
                        "name": f"delegate_{persona}",
                        "agent": "mike",
                        "childAgent": persona,
                        "output": content[:3000],
                    },
                )
            elif content:
                self.say("mike", scope["message_id"], content)
            return output

    def route(self) -> str:
        if not self.rt.previous:
            return "plan"
        self.stage(
            "route",
            "router",
            "Route follow-up",
            {
                "request": self.rt.context["request"],
                "template": self.rt.previous["template"],
                "files": sorted(self.rt.previous["files"]),
                "savedChecks": [check["name"] for check in self.workspace["checks"]],
            },
            lambda _: "",
        )
        route = self.workspace["route"]
        # Without saved checks there is no regression baseline for a quick edit.
        return route if route == "quick_edit" and self.workspace["checks"] else "plan"

    def plan(self) -> None:
        for attempt in range(2):
            self.stage(
                f"plan-{attempt}",
                "planner",
                "Define the brief, architecture and acceptance checks",
                {"request": self.rt.context["request"]},
                lambda output: self.workspace["brief"] or output,
            )
            if self.workspace["plan"]:
                break
        else:
            raise HarnessFailure("step_limit")
        # Bob's architecture comes from the same structured plan, shown as his handoff.
        name = get_persona_config("bob").display_name
        with self.rt.scoped("plan-architecture", "bob") as scope:
            self.rt.emit("agent_start", {"id": "bob", "name": name, "task": "Architecture"})
            self.say("bob", scope["message_id"], self.workspace["architecture"])
            self.rt.emit("agent_end", {"id": "bob", "name": name})

    def implement(self, kind: str, key: str, label: str, evidence: Any = None) -> None:
        task = {"request": self.rt.context["request"]}
        if evidence is not None:
            task["evidence"] = evidence
        self.stage(
            key,
            kind,
            label,
            task,
            lambda output: (self.workspace["candidate"] or {}).get("summary") or output,
        )

    def check_candidate(self, key: str) -> dict:
        """Deterministic build + browser validation attributed to implementation."""
        with self.rt.scoped(key, "alex"):
            if not current_build(self.workspace):
                built = self.rt.invoke(self.rt.build_project, {})
                if "error" in built:
                    return {"valid": False, "issues": [built["error"]]}
            report = self.rt.invoke(self.rt.validate_preview, {})
            if "error" in report:
                return {"valid": False, "issues": [report["error"]]}
            return report

    def repair(self, key: str, issues: list) -> None:
        with self.rt.scoped(f"{key}-notice", "alex"):
            self.rt.emit("repair", {"attempt": self.workspace["revision"] + 1, "issues": issues})
        self.implement("repair", key, "Repair the reported defects", {"failures": issues})

    def verify(self) -> None:
        """Collect missing implementation evidence for David's independent assessment."""
        self.rt.check()
        built = current_build(self.workspace)
        implementation = self.workspace["implementationValidation"]
        if (
            built
            and implementation
            and all(implementation.get(key) == built[key] for key in ("sourceHash", "artifactHash"))
        ):
            return
        self.check_candidate("verify-0")

    def coordinate_iteration(self, round: int) -> dict:
        """Ask Mike for a fresh next step without imposing a delivery-round limit."""
        attempt = 0
        while True:
            self.rt.check()
            key = f"iteration-{round}-{attempt}"
            path = f"{FLOW_VERSION}/{key}"
            self.stage(
                key,
                "coordinator",
                "Arrange the next implementation or review iteration",
                {
                    "request": self.rt.context["request"],
                    "review": self.workspace["review"],
                    "report": self.workspace["report"],
                    "completion": completion_status(self.workspace),
                    "candidate": self.workspace["candidate"],
                },
                lambda _: (
                    self.workspace["iteration"]["instructions"]
                    if (self.workspace.get("iteration") or {}).get("stage") == path
                    else ""
                ),
            )
            decision = self.workspace.get("iteration")
            if decision and decision.get("stage") == path:
                return decision
            attempt += 1

    def review(self) -> None:
        round = 0
        instructions = None
        while True:
            self.rt.check()
            plan = self.workspace["plan"] or {}
            task = {"request": self.rt.context["request"], "criteria": plan.get("criteria", [])}
            if instructions is not None:
                task["instructions"] = instructions
            # A stage that exhausts its allowance must not inherit an earlier verdict.
            self.workspace["review"] = None
            self.stage(
                f"review-{round}",
                "reviewer",
                "Independently validate and review the current build",
                task,
                lambda output: (self.workspace["review"] or {}).get("findings") or output,
            )
            status = completion_status(self.workspace)
            if "alex_validation" in status["missing"] and current_build(self.workspace):
                # The reviewer may have corrected checks; re-run implementation evidence.
                self.check_candidate(f"revalidate-{round}")
                status = completion_status(self.workspace)
            if status["ready"]:
                return
            decision = self.coordinate_iteration(round)
            instructions = decision["instructions"]
            if decision["next_step"] == "repair":
                self.repair(f"review-repair-{round}", [instructions])
                self.check_candidate(f"review-verify-{round}")
            round += 1

    def deliver(self) -> dict:
        if not completion_status(self.workspace)["ready"]:
            raise HarnessFailure("validation")
        candidate = (self.workspace["candidate"] or {}).get("summary", "")
        findings = (self.workspace["review"] or {}).get("findings", "")
        summary = "\n\n".join(part for part in (candidate, findings) if part)[:20_000]
        return {
            "source": self.workspace["source"],
            "html": self.workspace["html"],
            "checks": self.workspace["checks"],
            "summary": summary or "Accepted.",
        }
