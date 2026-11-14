"""Private, immutable selection interpretation; browser content is never authority."""

from __future__ import annotations

import copy
import json

from ..validator import validate_inspection


def elements(selection: dict) -> list[dict]:
    evidence = selection["evidence"]
    if evidence["kind"] == "element":
        return [evidence["element"]]
    return evidence["elements"]


def focus(selection: dict) -> dict | None:
    evidence = selection["evidence"]
    return evidence.get("focus") if evidence["kind"] == "region" else None


def contexts(selection: dict) -> list[dict]:
    members = elements(selection)
    focused = focus(selection)
    if focused and all(item["nodeId"] != focused["nodeId"] for item in members):
        return [*members, focused]
    return members


def summary(selection: dict | None) -> dict | None:
    if not selection:
        return None
    targets = elements(selection)
    return {
        "selectionId": selection["selectionId"],
        "versionId": selection["versionId"],
        "kind": selection["evidence"]["kind"],
        "targets": [
            {
                "tagName": item["tagName"],
                "text": item["text"][:200],
                "instance": item.get("instance"),
            }
            for item in targets[:4]
        ],
        "focus": (
            {
                "nodeId": focus(selection)["nodeId"],
                "tagName": focus(selection)["tagName"],
                "text": focus(selection)["text"][:200],
            }
            if focus(selection)
            else None
        ),
        "hasImage": bool(selection.get("image")),
        "sourceHash": selection["sourceHash"],
    }


def without_pixels(value: dict) -> dict:
    result = copy.deepcopy(value)
    if result.get("image"):
        result["image"].pop("base64", None)
    return result


def reproduction(selection: dict, request: dict) -> dict:
    """Only the existing declarative action vocabulary can replay a recipe.

    Free-form owner steps stay evidence. JSON action objects are a supported,
    bounded representation inside the persisted string list; no evaluation.
    An agent may translate prose to explicit tool actions, with normal validation.
    """
    result = dict(request)
    recipe = selection.get("reproduction") or {}
    if not result.get("clock") and recipe.get("clock"):
        result["clock"] = {"now": recipe["clock"], "timezone": "UTC"}
    if result.get("seed") is None and recipe.get("seed") is not None:
        result["seed"] = recipe["seed"]
    if not result.get("actions") and recipe.get("steps"):
        try:
            actions = [json.loads(step) for step in recipe["steps"]]
            if len(actions) > 16 or any(not isinstance(action, dict) for action in actions):
                raise ValueError()
            validate_inspection({"actions": actions})
            result["actions"] = actions
        except (ValueError, TypeError):
            result["unreproducedReason"] = (
                "The frozen scene has prose or unsupported reproduction steps. "
                "Supply bounded supported actions; arbitrary application memory cannot be restored."
            )
    return result
