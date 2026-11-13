"""Native CrewAI delivery graph and transient state; DBOS owns recovery."""

import uuid
from typing import Any, Callable, Literal

from crewai.flow.flow import Flow, listen, or_, router, start
from pydantic import BaseModel, Field, PrivateAttr

from .errors import HarnessFailure
from .stages import Delivery


class DeliveryState(BaseModel):
    # CrewAI requires a state id; this Flow is never persisted (DBOS owns recovery).
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    route: str = "plan"


class DeliveryFlow(Flow[DeliveryState]):
    """Native CrewAI Flow: code-owned routing, coordinated iterations, single artifact writer."""

    _skip_auto_memory: bool = True
    initial_state: type[DeliveryState] = DeliveryState
    _delivery: Any = PrivateAttr(default=None)
    _failure: Any = PrivateAttr(default=None)
    _result: Any = PrivateAttr(default=None)

    def __init__(self, delivery: Delivery):
        super().__init__(suppress_flow_events=True, tracing=False)
        self._delivery = delivery

    def _guard(self, operation: Callable[[], Any]) -> Any:
        # Failures must not cross the Flow's asyncio/thread boundary as cancellations;
        # they are re-raised unchanged on the caller's thread after kickoff.
        if self._failure is not None:
            return None
        try:
            return operation()
        except BaseException as error:
            self._failure = error
            return None

    @start()
    def coordinate(self) -> None:
        self.state.route = self._guard(self._delivery.route) or "plan"

    @router(coordinate)
    def dispatch(self) -> Literal["route_plan", "route_quick_edit", "halt"]:
        # Labels differ from method names: a string trigger also matches a method.
        if self._failure is not None:
            return "halt"
        return "route_quick_edit" if self.state.route == "quick_edit" else "route_plan"

    @listen("route_plan")
    def plan(self) -> None:
        self._guard(self._delivery.plan)

    @listen(plan)
    def build(self) -> None:
        self._guard(lambda: self._delivery.implement("builder", "build", "Implement the plan"))

    @listen("route_quick_edit")
    def quick_edit(self) -> None:
        self._guard(
            lambda: self._delivery.implement("quick_edit", "quick-edit", "Apply the quick edit")
        )

    @listen(or_(build, quick_edit))
    def verify(self) -> None:
        self._guard(self._delivery.verify)

    @listen(verify)
    def review(self) -> None:
        self._guard(self._delivery.review)

    @listen(review)
    def deliver(self) -> None:
        self._result = self._guard(self._delivery.deliver)

    def execute(self) -> dict:
        self.kickoff()
        if self._failure is not None:
            raise self._failure
        if self._result is None:
            raise HarnessFailure("internal")
        return self._result
