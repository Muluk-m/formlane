"""Sequential staging-only evaluation. Run from macmini2; never publishes projects."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid

STAGE_ORIGIN = "http://127.0.0.1:8094"
STAGE_DATABASE = "formlane_workflow_stage"
TERMINAL = {"completed", "failed", "cancelled"}
ROOT = Path(__file__).resolve().parent


class EvaluationError(Exception):
    pass


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise EvaluationError("Redirect rejected; verify the staging tunnel")


def save(path, data):
    """Private atomic local journal; no owner capabilities on stdout."""
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        os.chmod(temporary, 0o600)
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


class API:
    def __init__(self, owner):
        self.owner = owner
        self.opener = build_opener(ProxyHandler({}), NoRedirects())

    def open(self, method, path, payload=None):
        request = Request(
            STAGE_ORIGIN + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            method=method,
            headers={"x-owner-id": self.owner, "Content-Type": "application/json"},
        )
        try:
            return self.opener.open(request, timeout=30)
        except HTTPError as error:
            raise EvaluationError(f"Staging API returned HTTP {error.code}") from None
        except (URLError, TimeoutError, OSError):
            raise EvaluationError("Staging API transport failed; inspect the private journal before resuming") from None

    def json(self, method, path, payload=None):
        with self.open(method, path, payload) as response:
            return json.load(response)

    def events(self, project, run):
        # Read only after terminal; the API drains persisted events then closes SSE.
        events = []
        with self.open("GET", f"/api/projects/{project}/runs/{run}/events?after=0") as response:
            for raw in response:
                if raw.startswith(b"data: "):
                    event = json.loads(raw[6:])
                    if "sequence" in event:
                        events.append(event)
        return events


def event_metrics(events, run):
    sequences = [e["sequence"] for e in events]
    if sequences != list(range(1, run["cursor"] + 1)):
        raise EvaluationError("Persisted event replay is incomplete")
    first = next((e for e in events if e["type"] in {"file_start", "file_delta", "file_saved"}), None)
    first_saved = next((e for e in events if e["type"] == "file_saved"), None)
    # Replayed orchestration events are observations, not extra committed calls.
    reviews = {}
    repair_notices = []
    evidence = []
    for event in events:
        data = event["data"]
        row = {key: event[key] for key in ("sequence", "attempt", "type", "createdAt")}
        if event["type"] == "repair":
            repair_notices.append(row)
        if event["type"] == "tool_end" and data.get("name") == "record_review":
            output = data.get("output", {})
            row.update(operationId=data.get("id"), accepted=output.get("accepted") if isinstance(output, dict) else None)
            reviews[data["id"]] = row
        if event["type"] in {"file_start", "file_saved", "repair", "validation", "agent_start", "agent_end", "tool_start", "tool_end"}:
            row.update({key: data[key] for key in ("id", "name", "agent", "childAgent", "path") if key in data})
            if event["type"] == "validation":
                row["valid"] = data.get("valid")
            evidence.append(row)
    return {
        "eventCount": len(events), "terminalCursor": run["cursor"],
        "firstFileMs": first["createdAt"] - run["createdAt"] if first else None,
        "firstFileEvent": first["type"] if first else None,
        "firstSavedFileMs": first_saved["createdAt"] - run["createdAt"] if first_saved else None,
        "totalMs": run["finishedAt"] - run["createdAt"] if run["finishedAt"] is not None else None,
        "repairNoticeCount": len(repair_notices), "reviewRecords": list(reviews.values()),
        "evidence": evidence,
    }


def public_result(item):
    return {key: value for key, value in item.items() if key not in {"ownerId", "phase"}}


def journal(output, state):
    save(output / "private-state.json", state)
    save(output / "runs.json", {
        key: value for key, value in state.items() if key != "cases"
    } | {"cases": [public_result(item) for item in state["cases"]]})
    save(output / "run-ids.json", {"database": STAGE_DATABASE, "runs": [
        {"runId": item["run"]["id"], "projectId": item["projectId"]}
        for item in state["cases"] if item.get("run")
    ]})


def run(args):
    if args.api_origin != STAGE_ORIGIN:
        raise EvaluationError("Only the explicit loopback staging origin is allowed")
    if not socket.gethostname().lower().split(".")[0].startswith("macmini2"):
        raise EvaluationError("Generation evaluation must run on macmini2")
    target = json.loads(args.target.read_text())
    if (
        target.get("database") != STAGE_DATABASE
        or target.get("apiOrigin") != STAGE_ORIGIN
        or target.get("dbosVersion") != "3.5.0"
        or target.get("readOnly") is not True
    ):
        raise EvaluationError("Invalid staging target proof")
    if not 0 <= time.time() * 1000 - target["capturedAt"] < 86400000:
        raise EvaluationError("Refresh the read-only staging proof; it must be less than one day old")
    cases_bytes = (ROOT / "cases.json").read_bytes()
    cases = json.loads(cases_bytes)
    corpus_hash = hashlib.sha256(cases_bytes).hexdigest()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(output, 0o700)
    state_path = output / "private-state.json"
    if state_path.exists():
        if not args.resume:
            raise EvaluationError("Existing evaluation requires --resume or a fresh output directory")
        state = json.loads(state_path.read_text())
        if state["corpusSha256"] != corpus_hash or state["release"] != args.release:
            raise EvaluationError("Resume requires the same corpus and release label")
    else:
        if args.resume:
            raise EvaluationError("No private resume journal exists")
        state = {"schemaVersion": 1, "apiOrigin": STAGE_ORIGIN, "database": STAGE_DATABASE,
                 "release": args.release, "corpusSha256": corpus_hash, "startedAt": int(time.time() * 1000),
                 "target": target, "cases": []}
    by_id = {item["id"]: item for item in state["cases"]}
    for case in cases:
        item = by_id.get(case["id"])
        if item and item.get("phase") == "done":
            continue
        parent = by_id.get(case.get("dependsOn"))
        if item is None:
            item = {"id": case["id"], "category": case["category"], "prompt": case["prompt"],
                    "dependsOn": case.get("dependsOn"), "ownerId": parent["ownerId"] if parent else str(uuid.uuid4()),
                    "phase": "new", "savedSuccess": False, "semantic": {"status": "not-run"}}
            state["cases"].append(item)
            by_id[case["id"]] = item
        if parent and not parent.get("savedSuccess"):
            item.update(phase="done", status="blocked-baseline", reason="Dependency did not save a version")
            journal(output, state)
            continue
        if item["phase"] in {"create-pending", "start-pending", "undo-pending"}:
            raise EvaluationError("An interrupted mutation has no journaled response; reconcile it before --resume")
        api = API(item["ownerId"])
        if item["phase"] == "new":
            health = api.json("GET", "/api/health")
            if health.get("mock") is not False or not health.get("hasKey") or not health.get("executorConfigured"):
                raise EvaluationError("Staging must use a configured real provider and executor")
            item["model"] = health["model"]
            if parent:
                item["projectId"] = parent["projectId"]
                detail = api.json("GET", f"/api/projects/{item['projectId']}")
                if detail["project"]["currentVersionId"] != parent["versionId"]:
                    raise EvaluationError("Dependency no longer owns the current saved baseline")
                item["baselineVersionId"] = parent["versionId"]
            else:
                item["phase"] = "create-pending"
                journal(output, state)
                project = api.json("POST", "/api/projects", {"idea": case["prompt"]})["project"]
                item["projectId"] = project["id"]
            item["phase"] = "created"
            journal(output, state)
        project_path = f"/api/projects/{item['projectId']}"
        if case.get("action") == "undo":
            target_version = by_id[case["restoreCase"]]["versionId"]
            if item["phase"] == "created":
                version = api.json("GET", f"{project_path}/versions/{parent['versionId']}")["version"]
                if version["parentVersionId"] != target_version:
                    raise EvaluationError("Undo target is not the immediate saved parent")
                item["phase"] = "undo-pending"
                journal(output, state)
                restored = api.json("POST", project_path + "/restore", {"versionId": target_version})
                if restored["project"]["currentVersionId"] != target_version:
                    raise EvaluationError("Undo did not select the saved parent")
                item.update(phase="terminal", status="restored", versionId=target_version, savedSuccess=True)
                journal(output, state)
        else:
            if item["phase"] == "created":
                item["phase"] = "start-pending"
                journal(output, state)
                item["run"] = api.json("POST", project_path + ("/chat" if parent else "/generate"), {"content": case["prompt"]})["run"]
                item["phase"] = "running"
                journal(output, state)
            if item["phase"] == "running":
                while item["run"]["status"] not in TERMINAL:
                    # Bounded individual HTTP calls, no total generation deadline.
                    time.sleep(args.poll_seconds)
                    item["run"] = api.json("GET", project_path + f"/runs/{item['run']['id']}")["run"]
                    journal(output, state)
                item.update(phase="terminal", status=item["run"]["status"], versionId=item["run"]["versionId"])
                journal(output, state)
            events = api.events(item["projectId"], item["run"]["id"])
            item["events"] = event_metrics(events, item["run"])
            detail = api.json("GET", project_path)
            item["savedSuccess"] = bool(item["run"]["status"] == "completed" and item["versionId"] and detail["project"]["currentVersionId"] == item["versionId"])
            if not item["savedSuccess"] and parent:
                item["priorVersionPreserved"] = detail["project"]["currentVersionId"] == parent["versionId"]
        if item["savedSuccess"]:
            version = api.json("GET", project_path + f"/versions/{item['versionId']}")["version"]
            item["htmlSha256"] = hashlib.sha256(version["html"].encode()).hexdigest()
            if case.get("action") == "undo":
                item["undoExactSavedHtml"] = item["htmlSha256"] == by_id[case["restoreCase"]]["htmlSha256"]
            from browser_checks import evaluate
            try:
                item["semantic"] = evaluate(version["html"], case, args.browser_executable)
            except Exception as error:
                item["semantic"] = {"status": "infrastructure-error", "errorType": type(error).__name__}
            if case.get("action") == "undo" and not item["undoExactSavedHtml"]:
                item["semantic"]["status"] = "failed"
        item["phase"] = "done"
        journal(output, state)
        print(f"{case['id']}: {item['status']}; semantic={item['semantic']['status']}", flush=True)
    state["finishedAt"] = int(time.time() * 1000)
    journal(output, state)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-origin", required=True, choices=[STAGE_ORIGIN])
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--release", required=True, help="Exact deployed commit/build label, supplied by release owner")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--poll-seconds", type=float, default=5)
    parser.add_argument("--browser-executable")
    args = parser.parse_args()
    if args.poll_seconds < 1:
        parser.error("--poll-seconds must be at least 1")
    try:
        run(args)
    except KeyboardInterrupt:
        print("Observation interrupted. Existing generation continues; use --resume.", file=sys.stderr)
        return 130
    except EvaluationError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception as error:
        print(f"Evaluation stopped ({type(error).__name__}); private journal retained.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
