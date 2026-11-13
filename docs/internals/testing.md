# Testing strategy

## Scope and coordination

One integration owner runs authorized checks after shared edits land. Select explicit relevant test files and package typechecks; avoid overlapping installations, full builds, suites or watch processes. Delegated editing alone does not authorize verification. Test existence, historical screenshots and HTTP availability do not establish migrated production acceptance.

## Behavior boundaries

| Boundary             | Required coverage                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API/ownership        | Contract-compatible JSON/errors; preserved owner header; private project/chat/version/download isolation; explicit allowed/denied CORS origins                                                                                                                            |
| Provider/CrewAI      | Flow stage order and halting, bounded repair loops, per-stage tool budgets and reasoning effort, role-scoped tools, streaming, missing-key/provider failures and no mock fallback                                                                                         |
| PostgreSQL           | Explicit empty-database Alembic migration, constraints, atomic pointer/run transitions and concurrent lease fencing                                                                                                                                                       |
| Generation           | Current-source build and check-set evidence; implementation and independent validation/review; repair, safe failure categories and prior-version preservation                                                                                                             |
| Durability           | Cursor replay/deduplication, disconnect without cancellation, explicit cancel, lease expiry/reclaim, DBOS operation replay, stale late-write rejection and bounded individual operations                                                                                  |
| Source/compiler      | Cross-runtime source/hash fixtures, fixed templates, virtual imports, size/time/output bounds, stripped credentials and cancelled process cleanup                                                                                                                         |
| Browser isolation    | Native sandboxed Chromium, opaque iframe, network/WebSocket denial, declarative interaction/assertions, pinned clock/timezone at two moments, seeded randomness effective from the first app script (warm-up navigation), observation-only inspection and repair evidence |
| Versions/publication | Monotonic numbering, inspection without mutation, restore, ancestry-based Undo, independent remix, exact ZIP, frozen publication, republish and unpublish                                                                                                                 |
| UI                   | Query invalidation, draft retention, localized errors, keyboard/focus behavior, desktop/mobile layout and SPA reload                                                                                                                                                      |
| Static cutover       | Direct API origins, unchanged owner capability, old-client 307 method/body forwarding, public-link 302, SSE reconnect and origin-specific CORS                                                                                                                            |

Use the lowest boundary that reproduces the behavior. Extend existing cases rather than mirroring implementation or asserting only mocked calls. Database behavior needs real PostgreSQL locks/transactions. Backend fixtures require `TEST_DATABASE_URL` and isolate schema state in a dedicated test database. Keep the remote `formlane_test` database separate from stage and production.

Backend tests live in [apps/backend/tests](../../apps/backend/tests/); compiler tests in [apps/compiler/src](../../apps/compiler/src/); frontend/package tests remain alongside their modules. Use named pytest files from the backend environment and guarded named JavaScript tests. Inject time where possible; intercepted model HTTP is deterministic boundary coverage, not real-provider acceptance.

Browser tests require a sandbox-capable Chromium/Chrome compatible with Python Playwright. Select it through `BROWSER_EXECUTABLE_PATH` when needed. Preserve non-root execution and the sandbox; on Ubuntu, account for the host's AppArmor/user-namespace policy instead of adding `--no-sandbox`. Compiler and browser descendants must lose provider/database credentials and terminate on cancellation.

## Flow equivalence and library upgrade gates

The two approved seams are the public [delivery.execute_harness](../../apps/backend/src/formlane/delivery/__init__.py) entry point and the installed CrewAI/DBOS runtime. Use the prepared backend environment, a built compiler, sandboxed Chrome and an isolated PostgreSQL database through `TEST_DATABASE_URL`. From the repository root, the owner can run each gate explicitly:

```bash
# Gate 1: complete observable equivalence with the pre-refactor Flow.
uv run --project apps/backend pytest apps/backend/tests/test_flow_equivalence.py

# Gate 2: installed-library behavior plus real DBOS recovery and compatibility.
uv run --project apps/backend pytest apps/backend/tests/test_runtime_contract.py apps/backend/tests/test_durable_execution.py apps/backend/tests/test_execution_compatibility.py
```

Gate 1 replays twelve frozen scenarios: initial build, quick edit, plan follow-up, verify repair and its limit, review repair and its limit, disputed check, tool-budget exhaustion, missing key, cancellation and resume reusing committed operations. The [recordings](../../apps/backend/tests/fixtures/flow_equivalence/) were captured through the original harness at `af5e54f` before restructuring. `inputs.record` retains the original JSON bytes (SHA-256 `f433e43bc356abbdec48a443704641a308cabe2f947b72e54751c1efa8d1a000`); its extension prevents a generic JSON formatter from changing provenance. Each golden asserts that baseline and the input-byte hash, then compares the complete observation: source, HTML, accepted checks, event sequence/payloads, failure categories, provider tool-result messages, external outcomes and durable names/order. No event sorting, timestamp/ID masking or payload filtering is allowed. The suite has no capture/update mode, and missing recordings fail. Never regenerate or edit the inputs/goldens to bless a refactor.

Only external provider transport, compiler/browser outcomes, time/identity/randomness and the in-memory durable journal are controlled in equivalence replay. The real Flow, stages, workspace, tools, native executor and model-call boundary run unchanged. Those recordings establish behavior equivalence, not live-provider acceptance or real database recovery.

Gate 2 uses CrewAI `1.15.40` and DBOS `3.5.0` as installed. Native contracts prove raw file deltas precede tool execution, retry fragments reset, ordinary nonterminal tool batches stay sequential on the provider thread, PRE can block without executing a tool, POST relays the exact reason, and authority aborts stop execution. They also characterize why official stream listeners are not adopted: dependency dispatch can finish after provider return and the live durable scope, while ordinary listener errors are swallowed. The safe inline case and unsafe dependency case are both executable contracts, not skipped tests or a blanket listener guarantee. Application budget/lifecycle regressions in `test_agents.py` exercise invalid arguments without budget consumption, normal/abort cleanup, concurrent stage isolation and replay without repeated effects.

The PostgreSQL/DBOS cases exercise actual process death, dormant enqueue before dispatch, committed-operation reuse, same-run/new-attempt resume, scheduling-connection termination, replacement-lease fencing and cancellation of old producers. Compatibility cases cover `flow-v2` eligibility; retained but non-resumable `flow-v1`, `crew-v1` and `dbos-v1` history; portable sorted manifests of all packaged Python/YAML/YML/text files; credentials/cache exclusion; and source/resource additions, changes and removals. Drift or missing manifest evidence blocks unfinished replay and cached `SUCCESS` completion without repeating effects. Missing evidence after committed work fails closed, while an empty dormant enqueue remains recoverable. Durable names remain `formlane.flow.v1` and `flow-v1/...`. Do not substitute the in-memory equivalence journal for these database tests.

[Python CI](../../.github/workflows/python-checks.yml) partitions collection into four disjoint steps: frozen equivalence; native CrewAI contracts; DBOS recovery plus execution compatibility; and the complete `apps/backend/tests` root excluding exactly those four named files. The remainder includes configuration/startup, application hooks, model streaming, validator, storage, worker and API tests; future test files are included automatically. No file runs twice across these steps. Both gates must pass before a library bump or replay-affecting refactor; the full remainder and normal lint/compiler gates remain required. CI configuration alone is not evidence of a green candidate run.

Configuration coverage in `test_configuration.py` checks malformed resources fail before worker polling and loaded policy stays immutable/cached. Packaging verification must load all fourteen resources from both wheel and source distribution, including a fresh interpreter loading configuration from the wheel, not only a source checkout. Prompt wording assertions are not a substitute for the frozen gate or real-provider acceptance.

## End-to-end evidence

A real-provider acceptance pass covers idea → plan/build/verify/review Flow → validated saved preview → follow-up → history/restore/Undo → remix/download → publish/republish/unpublish → reload. Separately exercise reconnect, cancellation, individual operation timeouts and restart/reclaim with the current deployed backend. Healthy execution and queue waiting have no whole-run deadline; long-running work must retain renewable lease authority. Record release, run/version identity and observed result; a successful tool probe is narrower evidence.

UI evidence checks actual rendering, both locales, dialogs/focus, status treatment, source comparisons, 375px layouts and unsent drafts. Generated apps may use their requested visual style; the shell retains Skyline.

[Deployment](../operations/deployment.md) owns current release identities, completed Python/PostgreSQL cutover evidence and cleanup verification. Record results against the exact candidate and database; historical targeted test counts do not establish acceptance of a later release. Distinguish an eventual green CI run from a fix for intermittent browser failures.
