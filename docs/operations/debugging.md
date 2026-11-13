# Debugging

## Establish the failing boundary

Record environment/release, project/version, run ID, event cursor and the exact symptom. Treat reported failures as evidence. Redact ownership capabilities, provider/database secrets and private generated content.

| Symptom                                  | Start here                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Private project missing/rejected         | FastAPI ownership, unchanged `atoms_uid` / `x-owner-id`, contract error shape and exact-origin CORS                    |
| Browser cannot reach API                 | Build-time API origin, Caddy certificate/default SNI, 80/443 ingress, FastAPI loopback listener and CORS preflight     |
| Generation queues but never starts       | Python worker unit, matching database/environment, PostgreSQL run/lease and provider settings                          |
| Candidate exists but no saved version    | Current source/artifact/check hashes, implementation report, independent validation and David's acceptance             |
| Valid source blocked after checks change | Check-set invalidation and evidence-only revalidation; never weaken the acceptance gate to accept stale evidence       |
| Failure during execution                 | Persisted safe error category, worker journal, lease owner, DBOS operation history and tool/provider event             |
| Old run fails as incompatible            | Refactored worker requires `flow-v2` and matching saved manifest; check the active release before choosing a new run   |
| Slow plan or first file                  | `reasoning_effort` in `delivery/resources/stages.yaml`; planner checks must not hand-simulate the program              |
| Stage stops with a budget error          | Stage `tool_budgets`/`decide_now` in that YAML and scoped PRE/POST hooks in `delivery/hooks.py`                        |
| Worker fails before polling              | `delivery/configuration.py` startup error: invalid YAML, unknown policy field/tool set, or missing/empty text resource |
| Builder disputes checks                  | `candidate.checkDefects` routes failing checks to David; correct the check, never the valid application behavior       |
| Follow-up re-plans instead of quick edit | Router choice and saved `versions.acceptance_checks`; versions saved before `flow-v1` have none                        |
| Date or random behavior is flaky         | Check `clock`/`seed`, the validator warm-up navigation and that the app computes from `new Date()`/`Math.random()`     |
| Reconnect loses progress                 | Owned SSE cursor, PostgreSQL event order and client replay/deduplication; Caddy streaming flush                        |
| Cancelled run later writes               | Cancellation fence, transaction authority check, heartbeat loss and subprocess cleanup                                 |
| Compiler fails                           | JSON argv, built compiler entry, release working directory, permissions, virtual imports and fixed dependencies        |
| Chromium fails to launch                 | Non-root sandbox support, executable selection and host namespace/AppArmor policy                                      |
| Restore/Undo changes public app          | Current/ancestry pointer versus published pointer                                                                      |
| Wrong public version or download         | Published slug selection versus requested owned saved version and exact source snapshot                                |
| Import rejected                          | Exact six-table schema, empty/exact target, canonical manifest, ancestry policy, message order and cursor integrity    |
| Branding/controls regress                | Single i18n catalog, shared UI/Base UI variants and Skyline tokens                                                     |

## Local evidence and durability

Use isolated PostgreSQL with explicit Alembic migrations. Never reproduce destructive behavior against production. Network evidence should identify path/status/event, not full prompts or credentials. Inspect `app.py`, `storage.py` and `worker.py` under [the backend](../../apps/backend/src/formlane/) for HTTP, persistence and producer ownership. Start delivery debugging at [delivery.execute_harness](../../apps/backend/src/formlane/delivery/__init__.py): `flow.py` owns graph/state, `stages.py` owns routing/stage orchestration and repair bounds, `tools.py` holds concrete tool classes/declared stage sets, `schemas.py` defines arguments, and `workspace.py` owns evidence mutations and completion.

Persona policy, reasoning effort, iterations, tool sets and budgets come from `delivery/resources/stages.yaml`; adjacent text files contain goals/work contracts and shared checks. The enabled worker validates and caches immutable resources before Store creation/polling. Editing installed files cannot safely tune a running worker: there is no hot reload, and these bytes enter the compatibility manifest. Review a new release and restart through drain-and-switch. Confirm the imported source/resource path if an editable environment appears to use an older release.

For a budget regression, trace PRE validation/authority, allowed-call counting and POST's exact decide-now JSON relay in `delivery/hooks.py`. Malformed arguments do not consume allowance, even after exhaustion. A blocked valid call must not create a workspace effect or durable tool step. The hook scope covers only `agent.execute_task`; exit must restore previous hooks on both success and abort, and concurrent stages must not share counts. Native PRE rejection alone loses the custom reason. Ordinary hook exceptions can be swallowed; `RuntimeAbort` preserves authority failures.

For stream ordering or retry fragments, inspect `model_stream.py` and the synchronous provider adapter in `delivery/_crewai.py`. File deltas must precede the tool effect inside the durable call, and retry-local readers must discard abandoned partial JSON. Official event dependency dispatch can outlive that scope on another thread; a successful inline listener probe is insufficient to replace the adapter. The same adapter keeps tool batches ordered and the native executor Flow graph intact. For lost scheduling ownership, inspect `durable_execution.resume_with_authority` and `_dbos.py`: the SDK mutation must use the already-locked application transaction with no independent reconnect retry.

Distinguish `execution_version = flow-v2` from intentionally unchanged `formlane.flow.v1`/`flow-v1/...` durable names. The manifest includes every packaged `.py`, `.yaml`, `.yml` and `.txt` file under `formlane`, including modules outside delivery. Current bytes must match the saved application manifest before dispatch or consumption of cached DBOS `SUCCESS`; success can still await application completion. Missing evidence after any committed operation or successful workflow fails closed, whereas a dormant enqueue with no committed step can recover. `ExecutionVersionMismatch` rejects incompatible execution; resume returns 409 and the run is not resumable. Old histories remain stored. Never rewrite manifest evidence or rename durable operations to force recovery; use a new run or the retained compatible release. Reproduce at the [two testing gates](../internals/testing.md#flow-equivalence-and-library-upgrade-gates).

SSE does not own execution. Runs have no fixed wall-clock deadline; a 60-second lease renews every 10 seconds. Individual provider, compiler and browser operations retain bounded timeouts. Cancellation rejects late writes and aborts producer work. Restart reuses completed immutable checkpoints, while interrupted provider calls may repeat. A failed build/browser report is repair evidence and preserves the prior complete version.

Use two isolated identities for private access checks. Public HTML must not expose chat, source APIs or owner credentials. A generated page's own styling/logic failure is separate from a shell failure, and opaque preview storage restrictions are intentional.

## Deployment diagnosis

Read the current activation record in [deployment](deployment.md) before remote operations. Correlate Pages `/version.json`, backend `RELEASE_COMMIT`, imported module/process working directory, active service environment/database, run identity and journals for `formlane-python-api` / `formlane-python-worker`. Verify the live target rather than copying a historical release identity from a debug note. Staging preparation or HTTPS availability is not acceptance. Port 8094 belongs to another session's staging work and must remain untouched. Existing backend build metadata can be stale; use the release marker and actual imports to establish source identity.

Caddy 2.11.9 manages short-lived Let's Encrypt IP certificates. Preserve its TLS state, renewal access and `default_sni` setting for the NAT address; do not replace this with disabled certificate verification. FastAPI listens on `127.0.0.1:8090` and PostgreSQL on loopback 5432, neither publicly exposed. Keep API and worker pointed at the same intended database.

A rollback must retain one writable authority. Old Pages assets may call legacy paths; restoring them while removing forwarding can split writes between D1 and PostgreSQL. Fence writers before any data recovery. Never merge a staging snapshot into production or use reset/import as a generic repair. The `flow-v2` refactor has no schema change: its rollback drains to zero, switches API/worker executables together, and keeps the live database and new writes. The historical `flow-v1` schema-rollback instructions do not apply. The release helper persists its rollback script before changing the pointer; see the [flow-v2 procedure](deployment.md#runtime-module-release-flow-v2).

State observed cause, affected behavior, exercised checks and the exact remaining prerequisite. A build, HTTP 200, provider tool probe, rehearsal hash report and real production browser acceptance prove different things.
