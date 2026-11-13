"""Merge persisted evidence into JSON/Markdown reports or compare two evaluations."""

import argparse
from collections import Counter
import json
import os
from pathlib import Path
from statistics import median
import sys


def cell(value):
    if value is None:
        return "unavailable"
    return str(value).replace("|", "\\|").replace("\n", " ")


def seconds(value):
    return "unavailable" if value is None else f"{value / 1000:.2f}"


def save(prefix, report, markdown):
    prefix.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    for suffix, content in ((".json", json.dumps(report, ensure_ascii=False, indent=2) + "\n"), (".md", markdown + "\n")):
        path = prefix.with_suffix(suffix)
        with path.open("x", encoding="utf-8") as handle:
            os.chmod(path, 0o600)
            handle.write(content)


def summarize(cases):
    generated = [row for row in cases if row.get("run")]
    saved = [row for row in generated if row["savedSuccess"]]
    totals = [row["metrics"]["totalMs"] for row in generated if row["metrics"]["totalMs"] is not None]
    first = [row["metrics"]["firstFileMs"] for row in generated if row["metrics"]["firstFileMs"] is not None]
    return {
        "caseCount": len(cases), "generationRuns": len(generated),
        "statuses": dict(Counter(row.get("status", "unobserved") for row in cases)),
        "savedSuccesses": sum(row["savedSuccess"] for row in cases),
        "savedGenerationSuccesses": len(saved),
        "semanticPasses": sum(row["savedSuccess"] and row["semantic"]["status"] == "passed" for row in cases),
        "semanticStatuses": dict(Counter(row["semantic"]["status"] for row in cases)),
        "medianTotalMs": median(totals) if totals else None, "totalTimeSamples": len(totals),
        "medianFirstFileMs": median(first) if first else None, "firstFileSamples": len(first),
        "committedModelCalls": sum(row["metrics"]["committedModelCalls"] for row in generated),
        "committedRepairStages": sum(len(row["metrics"]["committedRepairStages"]) for row in generated),
        "committedReviewStages": sum(len(row["metrics"]["committedReviewStages"]) for row in generated),
        "recordedUsage": None, "recordedCost": None,
    }


def merge(args):
    run = json.loads(args.run.read_text())
    export = json.loads(args.metrics.read_text())
    if run.get("finishedAt") is None:
        raise ValueError("Evaluation is incomplete; retain partial runs.json and resume it")
    if export["target"]["database"] != run["database"] or not export["target"]["readOnly"]:
        raise ValueError("Metrics must come from a read-only export of the same staging database")
    metrics = {row["runId"]: row for row in export["runs"]}
    expected_ids = {row["run"]["id"] for row in run["cases"] if row.get("run")}
    if set(metrics) != expected_ids or len(metrics) != len(export["runs"]):
        raise ValueError("Metrics must cover exactly this evaluation's run identities")
    for row in run["cases"]:
        if not row.get("run"):
            row["metrics"] = None
            continue
        evidence = metrics[row["run"]["id"]]
        if any(evidence[key] != row["run"][field] for key, field in (
            ("projectId", "projectId"), ("status", "status"), ("attempt", "attempt"),
            ("versionId", "versionId"), ("terminalCursor", "cursor"),
        )):
            raise ValueError("Run changed after observation; collect a consistent snapshot")
        for field in ("eventCount", "terminalCursor", "firstFileMs", "firstSavedFileMs", "totalMs", "repairNoticeCount"):
            if evidence[field] != row["events"][field]:
                raise ValueError("API event replay and database evidence disagree")
        row["metrics"] = evidence
    run["metricsCapturedAt"] = export["target"]["capturedAt"]
    run["summary"] = summarize(run["cases"])
    lines = [
        "# Workflow evaluation", "", f"Release: `{cell(run['release'])}`. Corpus SHA-256: `{run['corpusSha256']}`.", "",
        f"Saved successes: **{run['summary']['savedSuccesses']}/{len(run['cases'])}**. "
        f"Independent semantic passes: **{run['summary']['semanticPasses']}/{len(run['cases'])}**. "
        f"Generation runs: {run['summary']['generationRuns']}; Undo is a saved-version selection, not a model call.", "",
        "Saved success means the run completed and its immutable result is current. Semantic pass additionally requires every fixed browser assertion. "
        "A completed run can fail semantics; infrastructure errors and blocked dependencies never count as passes.", "",
        "| Case | Status | Saved | Semantic | Run ID | First file (s) | Total (s) | Committed calls | Repair stages | Review stages |",
        "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in run["cases"]:
        metric = row["metrics"] or {}
        fields = [row["id"], row.get("status"), row["savedSuccess"], row["semantic"]["status"],
                  row.get("run", {}).get("id", "not applicable"), seconds(metric.get("firstFileMs")),
                  seconds(metric.get("totalMs")), metric.get("committedModelCalls"),
                  len(metric["committedRepairStages"]) if metric else None,
                  len(metric["committedReviewStages"]) if metric else None]
        lines.append("| " + " | ".join(cell(value) for value in fields) + " |")
    lines += ["", "## Persisted stage evidence", "",
              "Operation duration sums include only committed operations. Stage span runs from the first committed operation start to the last committed operation finish; "
              "it is not full stage wall time or provider billing time. Missing timestamps produce unavailable durations. Replay does not add a committed model call.", "",
              "| Case | Stage | Operations | Model calls | Timed operations | Duration sum (s) | Committed span (s) |",
              "| --- | --- | ---: | ---: | ---: | ---: | ---: |"]
    for row in run["cases"]:
        for stage in (row["metrics"] or {}).get("stages", []):
            lines.append("| " + " | ".join(cell(value) for value in [
                row["id"], stage["stage"], stage["committed_operations"], stage["committed_model_calls"],
                stage["timed_operations"], seconds(stage["operation_duration_sum_ms"]), seconds(stage["committed_stage_span_ms"]),
            ]) + " |")
    lines += ["", "## Independent browser evidence", ""]
    for row in run["cases"]:
        checks = row["semantic"].get("checks", [])
        lines.append(f"- **{cell(row['id'])}**: {cell(row['semantic']['status'])}; saved version `{cell(row.get('versionId'))}`, HTML SHA-256 `{cell(row.get('htmlSha256'))}`.")
        for check in checks:
            lines.append(f"  - {cell(check['name'])}: {'passed' if check['passed'] else 'failed'}; seed {check['seed']}; "
                         f"clock {cell(check.get('now'))}; {check['stepsPassed']} steps passed; "
                         f"page errors {check['pageErrorCount']}; error {cell(check.get('errorType'))}.")
    lines += ["", "## Measurement limits", "",
              "- Total time is persisted run creation through terminal finish, including queueing and repairs. First file is the earliest persisted file_start, file_delta or file_saved; JSON also records first file_saved separately.",
              "- Repair notices can repeat across replay. Committed repair/review stage counts come from uniquely named DBOS operations with committed model responses; failed uncommitted provider attempts are not counted.",
              "- Structured provider token usage and billed cost are not persisted by this workflow. Both remain null; there are no estimated tokens, invented prices or inferred charges.",
              "- Semantic checks cover the stated interactions, not every visual detail or accessibility requirement. Undo exercises the existing restore API and verifies exact saved HTML plus interactions; it does not establish shell button behavior.",
              "- The JSON includes operation IDs/timestamps, stage aggregates, run IDs, event metadata and per-check outcomes. It excludes owner capabilities, response bodies, database credentials and provider keys."]
    save(args.output, run, "\n".join(lines))


def comparison(args):
    baseline = json.loads(args.baseline.read_text())
    candidate = json.loads(args.candidate.read_text())
    if baseline["corpusSha256"] != candidate["corpusSha256"]:
        raise ValueError("Comparison requires identical fixed prompts and browser checks")
    before = {row["id"]: row for row in baseline["cases"]}
    after = {row["id"]: row for row in candidate["cases"]}
    if before.keys() != after.keys() or "summary" not in baseline or "summary" not in candidate:
        raise ValueError("Compare complete evidence-merged reports with identical case identities")
    pairs = []
    for case_id, old in before.items():
        new = after[case_id]
        pair = {"id": case_id, "baselineStatus": old["status"], "candidateStatus": new["status"],
                "baselineSaved": old["savedSuccess"], "candidateSaved": new["savedSuccess"],
                "baselineSemantic": old["semantic"]["status"], "candidateSemantic": new["semantic"]["status"],
                "baselineRunId": old.get("run", {}).get("id"), "candidateRunId": new.get("run", {}).get("id"),
                "bothSavedGeneration": bool(old.get("run") and new.get("run") and old["savedSuccess"] and new["savedSuccess"])}
        for field in ("firstFileMs", "totalMs", "committedModelCalls"):
            old_value = (old["metrics"] or {}).get(field)
            new_value = (new["metrics"] or {}).get(field)
            pair[field] = {"baseline": old_value, "candidate": new_value,
                           "delta": new_value - old_value if old_value is not None and new_value is not None else None}
        pairs.append(pair)
    comparable = [pair for pair in pairs if pair["bothSavedGeneration"] and pair["totalMs"]["delta"] is not None]
    report = {"schemaVersion": 1, "corpusSha256": baseline["corpusSha256"],
              "baselineRelease": baseline["release"], "candidateRelease": candidate["release"],
              "baselineSummary": baseline["summary"], "candidateSummary": candidate["summary"],
              "pairedSavedGenerationCount": len(comparable),
              "medianPairedTotalDeltaMs": median([pair["totalMs"]["delta"] for pair in comparable]) if comparable else None,
              "cases": pairs}
    lines = ["# Workflow evaluation comparison", "",
             f"Baseline: `{cell(baseline['release'])}`. Candidate: `{cell(candidate['release'])}`.", "",
             f"Saved successes: {baseline['summary']['savedSuccesses']} → {candidate['summary']['savedSuccesses']}. "
             f"Semantic passes: {baseline['summary']['semanticPasses']} → {candidate['summary']['semanticPasses']}.", "",
             f"Median paired total-time delta among {len(comparable)} generation cases saved in both evaluations: "
             f"{seconds(report['medianPairedTotalDeltaMs'])} seconds. Negative deltas are faster. Failure/status changes remain visible below; "
             "a fast failure is not a performance improvement.", "",
             "| Case | Baseline status / semantic | Candidate status / semantic | Baseline total (s) | Candidate total (s) | Total delta (s) | Call delta |",
             "| --- | --- | --- | ---: | ---: | ---: | ---: |"]
    for pair in pairs:
        lines.append("| " + " | ".join(cell(value) for value in [
            pair["id"], f"{pair['baselineStatus']} / {pair['baselineSemantic']}",
            f"{pair['candidateStatus']} / {pair['candidateSemantic']}", seconds(pair["totalMs"]["baseline"]),
            seconds(pair["totalMs"]["candidate"]), seconds(pair["totalMs"]["delta"]), pair["committedModelCalls"]["delta"],
        ]) + " |")
    lines += ["", "One run per case is descriptive evidence, not a statistical latency claim. "
              "Both runs use their own private baselines; model/provider/release metadata in the full reports must be considered when interpreting differences. "
              "Token usage and cost remain unavailable unless actually recorded; this comparison invents neither."]
    save(args.output, report, "\n".join(lines))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    merge_parser = commands.add_parser("merge")
    merge_parser.add_argument("--run", type=Path, required=True)
    merge_parser.add_argument("--metrics", type=Path, required=True)
    merge_parser.add_argument("--output", type=Path, required=True, help="New report prefix, without extension")
    compare_parser = commands.add_parser("compare")
    compare_parser.add_argument("--baseline", type=Path, required=True)
    compare_parser.add_argument("--candidate", type=Path, required=True)
    compare_parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        merge(args) if args.command == "merge" else comparison(args)
    except Exception as error:
        print(f"Report generation failed ({type(error).__name__}); input evidence was not modified.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
