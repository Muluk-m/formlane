"""Stage orchestration and bounded repair policy."""

from __future__ import annotations

import json
import time
from typing import Any, Callable

from crewai import Agent, Task

from ._crewai import ObservedOpenAI, SourceExecutor
from .configuration import get_persona_config, get_stage_config
from .errors import HarnessFailure, RuntimeAbort
from .hooks import stage_tool_hooks
from .tools import tools_for_stage
from .workspace import Runtime, completion_status, current_build

# Deterministic verification is free; model repair rounds are bounded per phase.
MAX_VERIFY_REPAIRS = 2
MAX_REVIEW_REPAIRS = 1


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
            agent = self.agent(kind)
            native = Task(
                description=json.dumps({"stage": label, **task}, ensure_ascii=False),
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
        """Gate the builder's own evidence; browser work only repeats when it is stale."""
        for round in range(MAX_VERIFY_REPAIRS + 1):
            built = current_build(self.workspace)
            implementation = self.workspace["implementationValidation"]
            if (
                built
                and implementation
                and all(
                    implementation.get(key) == built[key] for key in ("sourceHash", "artifactHash")
                )
            ):
                return
            report = self.check_candidate(f"verify-{round}")
            candidate = self.workspace["candidate"] or {}
            failing = {item["name"] for item in report.get("checks", []) if not item["passed"]}
            disputed = failing and failing.issubset(candidate.get("checkDefects", []))
            if report["valid"] or disputed or round == MAX_VERIFY_REPAIRS:
                # Disputed or remaining failures may be check defects, which the reviewer owns.
                return
            self.repair(f"repair-{round}", report["issues"])

    def review(self) -> None:
        for round in range(MAX_REVIEW_REPAIRS + 1):
            plan = self.workspace["plan"] or {}
            self.stage(
                f"review-{round}",
                "reviewer",
                "Independently validate and review the current build",
                {"request": self.rt.context["request"], "criteria": plan.get("criteria", [])},
                lambda output: (self.workspace["review"] or {}).get("findings") or output,
            )
            status = completion_status(self.workspace)
            if "alex_validation" in status["missing"] and current_build(self.workspace):
                # The reviewer may have corrected checks; re-run implementation evidence.
                self.check_candidate(f"revalidate-{round}")
                status = completion_status(self.workspace)
            if status["ready"]:
                return
            if round == MAX_REVIEW_REPAIRS:
                raise HarnessFailure("validation")
            review = self.workspace["review"]
            if review and not review["accepted"]:
                self.repair(f"review-repair-{round}", [review["findings"]])
                self.check_candidate(f"review-verify-{round}")

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
