# Architecture

Formlane uses FastAPI, native CrewAI and PostgreSQL on the existing GCP VM, with DBOS providing durable model/tool execution. Cloudflare Pages serves static React assets; Node remains the isolated trusted compiler. Release evidence is recorded in [deployment](../operations/deployment.md).

## Boundaries

| Module                                                           | Responsibility                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `apps/web`                                                       | React/Vite, TanStack Router/Query, assistant-ui runtime, owned API and SSE transport         |
| `apps/backend/src/formlane/app.py`                               | FastAPI HTTP routes, ownership, CORS, safe error compatibility and public documents          |
| `models.py`, `storage.py`, Alembic migrations                    | Six-table PostgreSQL authority, atomic state transitions, leases, events and checkpoints     |
| `worker.py`, `durable_execution.py`, `_dbos.py`                  | Lease-owning producer, compatibility/recovery and transaction-bound DBOS scheduling adapter  |
| `delivery/__init__.py`, `delivery/flow.py`                       | Public `execute_harness` entry point, Flow graph and state                                   |
| `delivery/stages.py`, `delivery/tools.py`, `delivery/schemas.py` | Stage orchestration, concrete tools and declared stage tool sets, argument/plan models       |
| `delivery/workspace.py`                                          | Workspace, durable operations, evidence mutations, candidate checkpoints and completion gate |
| `delivery/configuration.py`, `delivery/resources/`               | Startup-validated immutable YAML policy and packaged text contracts                          |
| `delivery/hooks.py`, `delivery/_crewai.py`, `model_stream.py`    | Scoped official budgets, private ordered executor/provider adapter and draft stream decoding |
| `validator.py`, `compiler.py`                                    | Sandboxed browser validation and bounded subprocess compilation                              |
| `apps/compiler`                                                  | Node compiler for in-memory project files and fixed template dependencies                    |
| `packages/contracts`                                             | oRPC/Zod browser contract; Python preserves its wire behavior                                |
| `packages/atoms-core`                                            | Runtime-independent TypeScript types, templates, source validation/hashing and helpers       |
| `packages/ui`, `packages/i18n`                                   | Shared accessible controls, Skyline styling and single bilingual catalog                     |

Source paths in the backend rows are relative to [the backend package](../../apps/backend/). Python has native project/template/hash helpers in `project.py`; cross-runtime fixtures preserve compatibility with shared TypeScript. Packages never import applications. The compiler has no business HTTP server, database connection or orchestration authority.

## API and browser transport

The browser keeps its contract-derived oRPC client, OpenAPILink and TanStack query/mutation options. FastAPI implements compatible routes, JSON shapes and errors. API changes update both language boundaries together rather than importing server application types into web.

`apps/web/src/lib/api.ts` centralizes session bootstrap, requests, SSE and downloads. `VITE_API_ORIGIN` selects the direct API and `VITE_API_PUBLIC_ORIGIN` selects public documents. The existing `atoms_uid` localStorage capability travels as `x-owner-id`; new requests omit cookies and bootstrap must preserve the supplied owner. Backend CORS permits explicit approved origins and transition support for older credentialed clients.

Pages contains static assets only. Temporary `/api/*` 307 redirects preserve methods/bodies for old clients. Public `/p/:slug` loads published HTML anonymously from Python inside an opaque full-screen iframe, keeping the custom domain in the address bar. It bypasses private owner bootstrap and application navigation. Frontend origins are build-time public configuration, never secrets.

## Durable execution and acceptance

1. An owned request creates a PostgreSQL run without a fixed wall-clock deadline. The worker claims a 60-second lease and renews it every 10 seconds. Explicit resume keeps the same run and committed results and advances its attempt. Lease fencing, cancellation and per-operation timeouts remain active.
2. A native CrewAI Flow (`DeliveryFlow`) owns stage order: route (follow-ups) → plan → build or quick edit → deterministic verify with at most two repairs → independent review with one repair → deliver. Each stage is one focused Agent ending at a terminal tool. DBOS records individual model requests and tool operations; Flow and stage orchestration stay outside steps. The refactored worker creates execution compatibility version `flow-v2`, while durable workflow/operation names remain `formlane.flow.v1` and `flow-v1/...`; see [ADR-0015](../adr/0015-flow-first-delivery.md) and [ADR-0014](../adr/0014-dbos-node-recovery.md). [Deployment](../operations/deployment.md) records whether that code is active.
3. Emma and Bob submit one structured plan: brief, criteria, template, architecture and acceptance checks written before code. Alex is the only source writer and ends with a successful current-source build. The harness runs implementation validation itself, prepending a fixed 375px smoke check. David independently reads baseline/current files, may correct checks, validates and accepts or requests repair.
4. Source edits invalidate stale build and acceptance evidence. Completion binds implementation validation, independent validation and explicit review to the current source, artifact and applicable check set. A successful build or an accepted stale report is insufficient.
5. Native Playwright validates an opaque iframe in fresh browser contexts. Chromium stays sandboxed; subprocess environments omit provider/database credentials. CSP, HTTP/WebSocket blocking and disabled service workers/downloads contain generated content. Checks are bounded declarative operations and assertions, not arbitrary privileged JavaScript.
6. An accepted candidate commits immutable source plus compiled HTML and ancestry atomically, updates current selection and completes the run. Failure, cancellation or deadline expiry preserves the previous complete version and publication.
7. Sequence-addressed SSE replays after the last cursor. Events and run snapshots identify the execution attempt; a previous attempt's terminal event cannot terminate a resumed attempt. Disconnect does not cancel work. Cancellation, deadline and lease loss fence the producer; explicit authorized resume reuses committed results. Uncommitted interrupted provider calls may repeat and be billed again.

Stage policy lives in [delivery/resources/stages.yaml](../../apps/backend/src/formlane/delivery/resources/stages.yaml), with thirteen text resources for goals, backstories, stage work and the shared browser-check contract. YAML declares persona names, reasoning effort, iteration limits, named tool sets and budgets. `configuration.py` validates and caches immutable data before the enabled worker opens Store or polls; invalid data fails startup. Both wheel and source distributions include the resources. There is no hot reload: configuration and prompt edits change replay compatibility and require release/restart. Contracts describe work; `flow.py`/`stages.py` decide routing, concrete classes in `tools.py` enforce declared capabilities, and `workspace.py` owns all evidence changes. Verify prompt behavior with real-provider workflows, not wording assertions.

Official PRE/POST hooks in `delivery/hooks.py` surround each stage's `agent.execute_task`. PRE checks authority and validates arguments before spending budget; exhausted valid calls skip durable tool execution. POST restores the original decide-now JSON because CrewAI's native PRE rejection discards the reason. Invalid arguments preserve allowance, and scoped counters/relay state cannot leak after success, failure or into concurrent stages. `delivery/_crewai.py` retains synchronous stream observation with retry-local readers, sequential native tool execution and the concrete-class Flow-definition workaround. Official chunk events with dependency handlers can finish after the durable scope closes, so their inline special case is insufficient for listener adoption. `_dbos.py` similarly isolates the SDK scheduling internals needed to use the application's locked transaction without independent reconnect retries.

The execution manifest hashes all packaged Python, YAML/YML and text resources under `formlane`, including modules outside delivery, with deterministic package-relative names. It excludes hidden/generated cache files and endpoint secrets. Recovery checks the current manifest against saved application evidence before dispatch or returning a cached DBOS `SUCCESS`. Missing evidence after committed work fails closed; an empty dormant enqueue without committed steps remains recoverable. The new worker retains old `flow-v1`/`crew-v1`/`dbos-v1` history but refuses execution and resume. Frozen entry-point equivalence and installed-library upgrade contracts guard observable behavior and durable ordering; [testing](testing.md#flow-equivalence-and-library-upgrade-gates) documents both executable gates.

File argument streaming exposes draft starts/deltas without committing partially parsed files. Validated tool completion saves working source; initialization/replay restores complete source trees. UI drafts, current working files and saved previews remain distinct. Paired tool events deduplicate on replay; missing results stay unfinished after failure or cancellation. Only supported public reasoning summaries may be exposed; never synthesize reasoning or persist raw model reasoning.

The compiler accepts virtual source and installed template dependencies. It does not execute generated package scripts, custom build plugins or dependency installs. Compiler time/output limits and process-group cancellation contain work. The downloadable ZIP remains a normal runnable Vite project.

## Persistence and product constraints

[Data model](data-model.md) defines all six business tables, migration/import fidelity and pointer semantics. Explicit Alembic migrations precede service use; neither startup nor requests bootstrap schema. PostgreSQL is the sole business authority after cutover, including durable execution. Legacy D1 is retained only as a fenced migration/rollback artifact.

Current, viewed and published versions are separate. Restore preserves later history, Undo follows recorded ancestry, and remix maps ancestry to independent identities. The source comparison's initial baseline is the preceding numbered version; it is not a claim about the actual generation parent after restoration. Generated interactive state remains in memory inside the opaque preview, not in the project database.

Execution indicators follow the explicitly observed run ID, never the timestamp of the latest received activity. A replacement run can be known before its first event arrives; earlier unfinished tools and pending text must remain interrupted during that gap and after terminal replay.

Saved-result cards are immutable conversation milestones, ordered by each version's saved timestamp. They must stay before subsequent requests instead of following the latest execution as a transcript footer. Their preview and comparison actions inspect that exact version; neither a new run nor restoring the current pointer relocates an earlier milestone.

Preserve the reference's package boundaries, strict TypeScript, contract-driven UI, Base UI/Hugeicons/Skyline, i18n and focused tooling. Its unrelated business models, billing and external integrations are outside Formlane. Historical Worker/D1/OpenAI Agents SDK implementation decisions remain explicitly marked in [ADRs](../adr/README.md).
