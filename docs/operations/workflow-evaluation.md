# How to evaluate workflow delivery on staging

The evaluation runs twenty fixed Chinese requests in sequence on macmini2, records saved outcomes separately from independent browser results, and merges persisted application events with DBOS operation metadata. Nineteen cases invoke generation; the twentieth exercises Undo by selecting the immediate saved parent through the existing restore API. Every evaluation creates its own private projects and owner capabilities. Follow-ups use only versions produced by that evaluation.

The artifacts are [the corpus](../../scripts/evaluation/cases.json), [runner](../../scripts/evaluation/run.py), [browser assertions](../../scripts/evaluation/browser_checks.py), [read-only exporter](../../scripts/evaluation/export_metrics.py), [stage SQL](../../scripts/evaluation/stages.sql), [report command](../../scripts/evaluation/report.py), and [saved-artifact rechecker](../../scripts/evaluation/recheck.py). They do not change the backend, Flow, replay policy, acceptance gates or package manifests.

## Target and prerequisites

The only permitted API origin is `http://127.0.0.1:8094`, forwarded to the existing staging listener on the GCP VM. The only permitted database is `formlane_workflow_stage`. Production URLs, another loopback port, redirects, production database names and a different DBOS schema/version are rejected. The API client ignores proxy environment variables. The target proof is a read-only database/schema observation; it does not independently authenticate the forwarding configuration. The operator must connect port 8094 to the stated staging listener, never the production listener on 8090.

| Resource                          | Required value                                                                               |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| Runner host                       | macmini2; hostname must start with `macmini2`                                                |
| Checkout                          | `~/rmake/formlane-followups`                                                                 |
| GCP project / VM / zone           | `roibest-internal-apps` / `formlane-agent` / `us-central1-c`                                 |
| Authorized GCP identity           | `maqiqian@roibest.com`                                                                       |
| Staging environment on VM         | `/etc/formlane/backend-workflow-stage.env`                                                   |
| Installed exporter Python         | `/opt/formlane/python-backend/releases/flow-release-20261113d/apps/backend/.venv/bin/python` |
| Exporter working directory / user | `/tmp` / `root` (the staging environment is root-owned, mode 0600)                           |
| DBOS package / schema             | `3.5.0` / `dbos`                                                                             |
| Browser                           | Sandboxed Chrome or Chromium, with Chinese fonts installed                                   |

Use the exact deployed release identity for `--release`; the runner records this operator-supplied label, the API-reported model and the corpus SHA-256. The API does not expose a release-identity endpoint. Changing the label does not deploy a release. Keep the same corpus and browser environment for baseline and candidate.

The runner needs only Python and Playwright. The VM exporter uses its existing pinned DBOS, SQLAlchemy, psycopg and python-dotenv installation. Database and provider credentials stay on the VM. On macmini2, prepare a dedicated environment if one is not already available:

```bash
uv venv --python 3.13 "$HOME/.cache/formlane-evaluation"
uv pip install --python "$HOME/.cache/formlane-evaluation/bin/python" 'playwright==1.65.1'
```

Use the installed Chrome executable with `--browser-executable '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`. If Chrome is unavailable, install the matching Playwright Chromium in this environment and omit the executable flag. Do not disable the browser sandbox. The browser receives a small environment allowlist, an opaque `allow-scripts allow-forms` iframe, blocked HTTP/WebSocket requests, and no owner capability or database/provider secret.

## Establish the staging connection

Run the existing authorized IAP connection from macmini2, or forward the already established operator tunnel to macmini2. A direct SSH tunnel through GCP is:

```bash
gcloud compute ssh formlane-agent \
  --project roibest-internal-apps --zone us-central1-c --account maqiqian@roibest.com --tunnel-through-iap \
  -- -N -L 127.0.0.1:8094:127.0.0.1:8094 -o ExitOnForwardFailure=yes
```

Keep the tunnel process alive throughout observation. No total evaluation or generation timeout should wrap this command or the runner. An existing reverse tunnel from the authorized operator workstation is also suitable when it maps macmini2 port 8094 to the same VM staging port. Do not open two listeners on the same local port.

Copy `scripts/evaluation/` to `/tmp/workflow-evaluation/` on the VM, preserving the directory's readable script files. The observed staging environment is root-owned with mode 0600; use sudo for the exporter without relaxing those permissions. Database access remains a read-only transaction enforced by the exporter.

```bash
cd /tmp
sudo \
  /opt/formlane/python-backend/releases/flow-release-20261113d/apps/backend/.venv/bin/python \
  /tmp/workflow-evaluation/export_metrics.py \
  --env-file /etc/formlane/backend-workflow-stage.env \
  --probe --output /tmp/workflow-stage-target.json
```

Transfer this sanitized proof to `~/workflow-evidence/workflow-stage-target.json` on macmini2 using the authorized SSH connection. The proof contains only database name, loopback origin, timestamp, pinned DBOS version and read-only status. It expires after one day; refresh it to a new output path if needed. The exporter refuses to overwrite existing evidence. Transfer a separate copy of the output if SSH ownership requires it; do not change the private environment's permissions or print its contents or connection URL.

## Run the complete baseline

On macmini2:

```bash
cd "$HOME/rmake/formlane-followups"
"$HOME/.cache/formlane-evaluation/bin/python" scripts/evaluation/run.py \
  --api-origin http://127.0.0.1:8094 \
  --target "$HOME/workflow-evidence/workflow-stage-target.json" \
  --release flow-release-20261113d \
  --output "$HOME/workflow-evidence/baseline" \
  --browser-executable '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

The runner never publishes, deletes or resumes a failed application run automatically. It waits sequentially for each accepted run receipt to reach a terminal state. A thirty-second individual HTTP timeout and five-second browser assertions bound individual operations; there is no total generation deadline. Failed generation is recorded, independent cases continue, and follow-ups whose baseline never saved are reported as `blocked-baseline`. A saved baseline whose independent assertions failed still receives its dependent follow-up, with that failure retained in the report.

| Cases                                                            | Coverage                                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `signup`, `expense`, `bmi`, `temperature`                        | Required fields, Chinese input, numeric boundaries, rounding and empty versus zero        |
| `filter`, `chinese-search`, `todo`                               | Native selection, intersected filters, Chinese substrings, adding/checking/deleting state |
| `counter` → `counter-feature` → `counter-style` → `counter-undo` | +1 baseline, +2 feature and decrement, style-only preservation, immediate-parent Undo     |
| `dice`, `game-2048`, `guess`                                     | Seeded random runs, legal outcomes, keyboard state changes, range guards and reset        |
| `today`, `date-range`                                            | At-load current date, year rollover, leap years, date order and same-day results          |
| `cart`, `quiz`                                                   | Decimal totals and disabled boundary controls; answer feedback and retry                  |
| `signup-style`, `filter-feature`                                 | Form regression under styling; new clear/count functionality preserving filter behavior   |

The Chinese prompts intentionally specify stable selectors and exact expected behavior. The evaluator uses these independent checks, not the generated acceptance-check set. Each random-game check runs with seeds 7 and 29; it checks legal state transitions rather than specific random tile positions. The date-at-load case runs at two distinct frozen instants. A warm iframe navigation ensures clock, timezone and seeded `Math.random` overrides apply before the actual app's first script. Other randomness sources are not overridden; the game assertions therefore avoid exact random outcomes. Computed CSS assertions test the requested button colors and radii.

Undo does not send its Chinese request to the model. It verifies that the target is the current version's actual parent, restores that saved version, compares the exact HTML SHA-256 against the earlier saved feature, and exercises the restored controls. This is API and preview evidence; the shell's Undo button requires its separate browser acceptance.

## Export persisted metrics and generate reports

The runner writes:

| File                 | Contents                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `private-state.json` | Resume journal, private owner capabilities and phases; never transfer to public logs or commit            |
| `runs.json`          | Sanitized run/status/version identities, prompts, model, HTML hashes, event metadata and browser outcomes |
| `run-ids.json`       | Only staging database name and the evaluation's run/project identities; input for the VM exporter         |

Directories are mode 0700 and files mode 0600. Console output contains case IDs, statuses and semantic outcomes, not owner capabilities, API responses, provider keys or connection strings.

Transfer `baseline/run-ids.json` to `/tmp/workflow-baseline-run-ids.json` on the VM. Run:

```bash
cd /tmp
sudo \
  /opt/formlane/python-backend/releases/flow-release-20261113d/apps/backend/.venv/bin/python \
  /tmp/workflow-evaluation/export_metrics.py \
  --env-file /etc/formlane/backend-workflow-stage.env \
  --runs /tmp/workflow-baseline-run-ids.json \
  --output /tmp/workflow-baseline-metrics.json
```

Transfer the sanitized metrics file to `~/workflow-evidence/baseline/metrics.json` on macmini2. The exporter never reads provider-output bodies, deserializes pickle values, imports the application runtime, schedules DBOS work or mutates application data. It checks the database name before connecting and again inside a repeatable-read, read-only transaction, validates the inspected DBOS column types, and restricts all data queries to the supplied run IDs with matching project IDs.

Merge the evidence:

```bash
cd "$HOME/rmake/formlane-followups"
"$HOME/.cache/formlane-evaluation/bin/python" scripts/evaluation/report.py merge \
  --run "$HOME/workflow-evidence/baseline/runs.json" \
  --metrics "$HOME/workflow-evidence/baseline/metrics.json" \
  --output "$HOME/workflow-evidence/baseline/report"
```

This creates `report.json` and `report.md`, refusing to overwrite existing reports. Merge requires a completed evaluation, exact run-ID coverage, matching terminal snapshots, and matching API/database event counts and timing metrics. It will not fill missing DBOS observations with estimates or zeros. An observed empty operation set for a run that failed before execution legitimately has zero committed calls.

## Compare the candidate

After the integration owner activates the intended candidate on the same isolated staging service, refresh the read-only target proof. Use the candidate's exact release identity and a new output directory:

```bash
cd "$HOME/rmake/formlane-followups"
"$HOME/.cache/formlane-evaluation/bin/python" scripts/evaluation/run.py \
  --api-origin http://127.0.0.1:8094 \
  --target "$HOME/workflow-evidence/workflow-stage-target-candidate.json" \
  --release "$CANDIDATE_RELEASE" \
  --output "$HOME/workflow-evidence/candidate" \
  --browser-executable '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

Set `CANDIDATE_RELEASE` to the actual deployed commit/build label before invoking the command. Export the candidate's own `run-ids.json` on the VM as above, transfer it as `candidate/metrics.json`, then run:

```bash
"$HOME/.cache/formlane-evaluation/bin/python" scripts/evaluation/report.py merge \
  --run "$HOME/workflow-evidence/candidate/runs.json" \
  --metrics "$HOME/workflow-evidence/candidate/metrics.json" \
  --output "$HOME/workflow-evidence/candidate/report"

"$HOME/.cache/formlane-evaluation/bin/python" scripts/evaluation/report.py compare \
  --baseline "$HOME/workflow-evidence/baseline/report.json" \
  --candidate "$HOME/workflow-evidence/candidate/report.json" \
  --output "$HOME/workflow-evidence/comparison"
```

Comparison rejects different corpus hashes or case identities. It shows saved and semantic outcomes alongside per-case timing/call deltas. Its paired timing summary uses only generation cases that saved in both evaluations; a faster failure does not improve that summary. A single run per case is descriptive evidence, not a statistically reliable latency claim. Keep provider/model, deployed source, browser version and machine differences visible when interpreting results.

## Metric definitions and exact SQL

The inspected DBOS 3.5.0 staging schema uses `dbos.operation_outputs(workflow_uuid text, function_id integer, function_name text, output text, error text, started_at_epoch_ms bigint, completed_at_epoch_ms bigint, serialization text, ...)`. Its primary key is `(workflow_uuid, function_id)`. Both timing fields are epoch milliseconds. The SQL in [stages.sql](../../scripts/evaluation/stages.sql) uses these actual columns; it does not assume a `created_at`, `duration` or `stage` column on operation outputs.

| Metric                       | Evidence and meaning                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status / run ID / version ID | Persisted `public.runs`, cross-checked with the owner's API snapshot                                                                                      |
| Saved success                | Completed run with a non-null immutable version ID that is current on its private project; Undo is separately `restored`                                  |
| Semantic pass                | Saved success plus all independent browser assertions; infrastructure errors and skipped checks cannot pass                                               |
| First file                   | Earliest persisted `file_start`, `file_delta` or `file_saved` timestamp minus run creation; event type is included                                        |
| First saved file             | First persisted `file_saved` minus run creation; distinct from streamed drafts                                                                            |
| Total time                   | Persisted `finished_at - created_at`, including queueing, repairs and replay; no synthetic terminal time                                                  |
| Committed model calls        | Successful non-null-output DBOS rows whose operation names end in `/llm-N`; committed replay is counted once                                              |
| Repair stages                | Distinct `repair-N` or `review-repair-N` stages containing committed model calls                                                                          |
| Review stages                | Distinct `review-N` stages containing committed model calls; review-tool operation counts and persisted accepted/rejected review events are also retained |
| Stage operation duration sum | Sum of committed `completed_at_epoch_ms - started_at_epoch_ms`; unavailable if any included timestamp is missing or invalid                               |
| Committed stage span         | Last committed completion minus first committed start within a stage; not the entire orchestrator stage's wall time                                       |
| Repair notices               | Persisted `repair` events; replay may repeat these, so they are not substituted for committed repair-stage counts                                         |
| Tokens / cost                | Null: the current workflow records response content but no structured provider usage or billed cost; no estimated tokens or invented prices               |

The exporter executes [stages.sql](../../scripts/evaluation/stages.sql) directly with a bound `text[]` of run IDs. To run the same query manually with the installed SQLAlchemy/psycopg environment, bind `run_ids` to a Python list of the selected UUID strings inside a `REPEATABLE READ, READ ONLY` transaction. The executable exporter is the supported command wrapper; no textual SQL substitution is required. Stage keys come from the second component of `flow-v1/<stage>/<operation>` names. Metadata/candidate rows remain identifiable as their own stage groups rather than being mislabeled as model work. Missing operation timestamps stay null. Uncommitted provider calls and retries that never persisted a result are outside this metric's coverage.

## Observed exporter verification (2026-11-13)

The exporter successfully queried two existing staging runs in a verified read-only transaction against DBOS 3.5.0. These historical observations validate the query; they are not the new twenty-case evaluation baseline.

| Existing staging run                                     | First file (ms) | Total (ms) | Committed model calls |
| -------------------------------------------------------- | --------------: | ---------: | --------------------: |
| `194cf371-4777-4d31-8ad8-64a630e18416` (2048 creation)   |          125186 |    1001636 |                    63 |
| `6b7be231-65e8-4fd2-b33f-690962941a66` (style follow-up) |           37473 |     182778 |                    18 |

The creation's planner used two committed calls over 93868 ms; its two review stages used 31 and 11 calls. One repair stage was recorded. The follow-up used one routing call, twelve quick-edit calls and five review calls. Structured provider usage and billed costs were absent and remained null. Creation recorded 344 events, matching its terminal cursor of 344; no provider-output body was read.

## First complete baseline (2026-11-13)

macmini2 completed the full corpus against staging release `flow-release-20261113d` using `grok-4.7`. All nineteen generation runs saved, and Undo restored the exact accepted parent. The read-only DBOS export matched the API terminal snapshots and event counts. The [complete baseline report](../research/2026-11-13-workflow-baseline.md) preserves run IDs, saved-artifact hashes, stage timing and independent browser outcomes.

| Observed metric                       |  Baseline |
| ------------------------------------- | --------: |
| Saved generation runs                 |     19/19 |
| Saved-parent Undo                     |       1/1 |
| Independent browser cases passed      |     19/20 |
| Median first file, 19 generation runs |  58.947 s |
| Median total time, 19 generation runs | 134.940 s |
| Committed model calls                 |       325 |
| Committed repair stages               |         0 |

The dice case passed seed 7 but raised `ValueError` when reading the first numeric result at seed 29. Eight subsequent isolated replays of the same saved HTML passed both seeds without changing the evaluator or application. The original failure remains in the baseline; its cause is unresolved and is not counted as a confirmed application defect. No retry result replaces first-pass evidence.

The baseline already has zero committed repair stages. The [complete first-candidate comparison](../research/2026-11-13-workflow-comparison.md) records a median paired first-file change of -0.727 s, 325 to 297 committed calls, and an additional 2048 repair stage; it does not establish a reliable latency improvement. Four baseline applications had check defects despite zero repair stages. Shared stage guidance now forbids impossible native-control actions and unobserved seeded-state assumptions, and tells David to correct a mistaken check before requesting implementation repair. Targeted real-model verification of that refinement is recorded separately from the first full candidate cohort.

The complete private collection remains under `/Users/mac/formlane-evaluation/baseline-20261113` on macmini2. Its `report.json` contains sanitized operation evidence; `private-state.json` contains owner capabilities and must remain private. Structured token usage and billed cost were absent and remain null.

## Assertion-only artifact rechecks

A corrected assertion may be rechecked without generating new applications only when every request, case identity, category, dependency and action remains unchanged. Preserve the exact original corpus and completed collection. `recheck.py` rejects changed request metadata, verifies every saved HTML hash, uses only GET requests, and writes a new directory. It retains `originalSemantic` and the original corpus hash; run timing and DBOS evidence remain unchanged. Undo's original restore evidence is retained, while the saved restored artifact's interactions are checked again.

For the recorded collection on macmini2:

```bash
cd "$HOME/rmake/formlane-followups"
.evaluation-venv/bin/python scripts/evaluation/recheck.py \
  --input /Users/mac/formlane-evaluation/baseline-20261113 \
  --original-corpus /Users/mac/formlane-evaluation/original-cases.json \
  --corpus scripts/evaluation/cases.json \
  --output /Users/mac/formlane-evaluation/baseline-rechecked-new \
  --browser-executable '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

Recheck the complete candidate collection with the same revised corpus into another new directory. Merge each new `runs.json` with its original `metrics.json`, then compare those new reports. Label these as artifact-only rechecks, not fresh model evaluations, and retain both first-pass reports. The date-range correction accepts `2天` and `2 天` while rejecting `12天`, `-2 天` and `2.2天`; forty artifact rechecks passed, and the changed-request refusal was exercised independently.

## Interruption and troubleshooting

- **Observation interrupted:** stop only observation if needed. Accepted generation continues independently. Re-run the baseline or candidate command with `--resume`, the same output directory, corpus and release label. The runner polls the recorded run ID instead of starting another run. Refresh an expired target proof first. There is no automatic cancel or resume API mutation.
- **Mutation response was lost:** phases `create-pending`, `start-pending` and `undo-pending` fail closed on restart. Use the retained owner capability privately to inspect `/api/projects`, `/api/projects/{id}/runs/latest`, or the current version as appropriate. Reconcile the journal to the observed project/run/version before resuming. Never blindly retry the POST, replace the owner capability or start a duplicate baseline. Keep the interrupted journal as evidence.
- **Transport failure:** repair the IAP/SSH listener, then use `--resume`. Redirects are rejected rather than following an accidentally selected public endpoint. Request errors print a safe status/type only.
- **Browser infrastructure error:** verify the explicit executable, Playwright version, sandbox capability and Chinese font availability. The report distinguishes this from a semantic failure. Do not relabel an unobserved check as passed. A fresh complete evaluation is appropriate after changing the browser environment.
- **Generated app assertion failed:** inspect the recorded case, saved version/hash, assertion step and application through its private owner. Do not weaken a correct criterion. An assertion-only correction requires complete artifact rechecks of both collections under the same revised corpus, as above. A changed request, action or dependency requires fresh generation evaluations.
- **Export failed:** check private file permissions, staging environment selection, installed package version and actual schema without printing secrets. Never point it at production to obtain missing rows. Export errors intentionally omit driver exception text because it can contain credentials.
- **Report merge failed:** use the full retained inputs to identify missing/stale IDs or mismatched event cursors. Export again to a new file once the intended run snapshots are consistent. Missing evidence is a failed collection step, not a zero-valued metric.

The integration owner performs verification and the real baseline. Narrow offline checks are Python syntax compilation of the five scripts and JSON parsing of `cases.json`; the operational checks are the read-only staging probe, full sequential corpus, DBOS export, report merge and comparison. No successful baseline, semantic result or timing is claimed merely because these scripts exist.

Related guidance: [deployment](deployment.md), [testing strategy](../internals/testing.md), [Flow-first delivery](../adr/0015-flow-first-delivery.md), and [LESSONS](../../LESSONS.md).
