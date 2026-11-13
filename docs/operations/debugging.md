# Debugging

## Establish the failing boundary

Record environment/release, project/version, run ID, event cursor and the exact symptom. Treat reported failures as evidence. Redact ownership capabilities, provider/database secrets and private generated content.

| Symptom                                  | Start here                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Private project missing/rejected         | FastAPI ownership, unchanged `atoms_uid` / `x-owner-id`, contract error shape and exact-origin CORS                 |
| Browser cannot reach API                 | Build-time API origin, Caddy certificate/default SNI, 80/443 ingress, FastAPI loopback listener and CORS preflight  |
| Generation queues but never starts       | Python worker unit, matching database/environment, PostgreSQL run/lease and provider settings                       |
| Candidate exists but no saved version    | Current source/artifact/check hashes, implementation report, independent validation and David's acceptance          |
| Valid source blocked after checks change | Check-set invalidation and evidence-only revalidation; never weaken the acceptance gate to accept stale evidence    |
| Failure during execution                 | Persisted safe error category, worker journal, lease owner, DBOS operation history and tool/provider event          |
| Old run fails as incompatible            | `execution_version` other than `flow-v1`, or a changed execution manifest; start a new run instead of resuming      |
| Slow plan or first file                  | Per-stage `reasoning_effort` in `STAGES`; planner checks must not hand-simulate the program                         |
| Stage stops with a budget error          | `TOOL_BUDGETS` per persona; the agent must decide with current evidence, not explore further                        |
| Builder disputes checks                  | `candidate.checkDefects` routes failing checks to David; correct the check, never the valid application behavior    |
| Follow-up re-plans instead of quick edit | Router choice and saved `versions.acceptance_checks`; versions saved before `flow-v1` have none                     |
| Date or random behavior is flaky         | Check `clock`/`seed`, the validator warm-up navigation and that the app computes from `new Date()`/`Math.random()`  |
| Reconnect loses progress                 | Owned SSE cursor, PostgreSQL event order and client replay/deduplication; Caddy streaming flush                     |
| Cancelled run later writes               | Cancellation fence, transaction authority check, heartbeat loss and subprocess cleanup                              |
| Compiler fails                           | JSON argv, built compiler entry, release working directory, permissions, virtual imports and fixed dependencies     |
| Chromium fails to launch                 | Non-root sandbox support, executable selection and host namespace/AppArmor policy                                   |
| Restore/Undo changes public app          | Current/ancestry pointer versus published pointer                                                                   |
| Wrong public version or download         | Published slug selection versus requested owned saved version and exact source snapshot                             |
| Import rejected                          | Exact six-table schema, empty/exact target, canonical manifest, ancestry policy, message order and cursor integrity |
| Branding/controls regress                | Single i18n catalog, shared UI/Base UI variants and Skyline tokens                                                  |

## Local evidence and durability

Use isolated PostgreSQL with explicit Alembic migrations. Never reproduce destructive behavior against production. Network evidence should identify path/status/event, not full prompts or credentials. Inspect `app.py`, `storage.py`, `worker.py` and `agents.py` under [the backend](../../apps/backend/src/formlane/) for the corresponding boundary.

SSE does not own execution. Runs have no fixed wall-clock deadline; a 60-second lease renews every 10 seconds. Individual provider, compiler and browser operations retain bounded timeouts. Cancellation rejects late writes and aborts producer work. Restart reuses completed immutable checkpoints, while interrupted provider calls may repeat. A failed build/browser report is repair evidence and preserves the prior complete version.

Use two isolated identities for private access checks. Public HTML must not expose chat, source APIs or owner credentials. A generated page's own styling/logic failure is separate from a shell failure, and opaque preview storage restrictions are intentional.

## Deployment diagnosis

Read [deployment](deployment.md) before remote operations. Correlate Pages `/version.json`, backend release, active service environment/database, run identity and journal entries for `formlane-python-api` / `formlane-python-worker`. The current services use the stage environment: reaching the reserved HTTPS IP is not evidence that the final database has been activated.

Caddy 2.11.9 manages short-lived Let's Encrypt IP certificates. Preserve its TLS state, renewal access and `default_sni` setting for the NAT address; do not replace this with disabled certificate verification. FastAPI listens on `127.0.0.1:8090` and PostgreSQL on loopback 5432, neither publicly exposed. Keep API and worker pointed at the same intended database.

A rollback must retain one writable authority. Old Pages assets may call legacy paths; restoring them while removing forwarding can split writes between D1 and PostgreSQL. Fence writers before any data recovery. Never merge a staging snapshot into production or use reset/import as a generic repair.

State observed cause, affected behavior, exercised checks and the exact remaining prerequisite. A build, HTTP 200, provider tool probe, rehearsal hash report and real production browser acceptance prove different things.
