"""Recheck immutable staging artifacts after assertion-only corpus corrections."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import time

from browser_checks import evaluate
from run import API, STAGE_DATABASE, STAGE_ORIGIN


def compatible_cases(original, revised):
    def requests(cases):
        return [{key: value for key, value in case.items() if key != "checks"} for case in cases]

    if requests(original) != requests(revised):
        raise ValueError("Changed requests or actions require a new generation evaluation")
    return {case["id"]: case for case in revised}


def recheck(args):
    if not socket.gethostname().lower().split(".")[0].startswith("macmini2"):
        raise ValueError("Artifact rechecks must run on macmini2")
    original_bytes = args.original_corpus.read_bytes()
    revised_bytes = args.corpus.read_bytes()
    cases = compatible_cases(json.loads(original_bytes), json.loads(revised_bytes))
    run = json.loads((args.input / "runs.json").read_text())
    private = json.loads((args.input / "private-state.json").read_text())
    original_hash = hashlib.sha256(original_bytes).hexdigest()
    if any(document.get("database") != STAGE_DATABASE or document.get("apiOrigin") != STAGE_ORIGIN
           or document.get("corpusSha256") != original_hash or not document.get("finishedAt")
           for document in (run, private)):
        raise ValueError("A complete matching staging collection is required")
    if [case["id"] for case in run["cases"]] != list(cases):
        raise ValueError("The complete original case order is required")
    owners = {case["id"]: case for case in private["cases"]}
    for case in run["cases"]:
        case["originalSemantic"] = case["semantic"]
        if not case["savedSuccess"]:
            continue
        identity = owners[case["id"]]
        if any(identity[key] != case[key] for key in ("projectId", "versionId")):
            raise ValueError("Private and public artifact identities differ")
        version = API(identity["ownerId"]).json(
            "GET", f"/api/projects/{case['projectId']}/versions/{case['versionId']}"
        )["version"]
        if hashlib.sha256(version["html"].encode()).hexdigest() != case["htmlSha256"]:
            raise ValueError("The saved artifact differs from its recorded hash")
        try:
            case["semantic"] = evaluate(version["html"], cases[case["id"]], args.browser_executable)
        except Exception as error:
            case["semantic"] = {"status": "infrastructure-error", "errorType": type(error).__name__}
        print(f"{case['id']}: rechecked={case['semantic']['status']}", flush=True)
    run["corpusSha256"] = hashlib.sha256(revised_bytes).hexdigest()
    run["recheck"] = {"originalCorpusSha256": original_hash, "checkedAt": int(time.time() * 1000),
                      "scope": "saved-artifacts-only", "generationTimingsUnchanged": True}
    args.output.mkdir(parents=True, exist_ok=False, mode=0o700)
    with (args.output / "runs.json").open("x") as handle:
        json.dump(run, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--original-corpus", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--browser-executable")
    try:
        recheck(parser.parse_args())
    except Exception as error:
        print(f"Artifact recheck failed ({type(error).__name__}); original evidence retained.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
