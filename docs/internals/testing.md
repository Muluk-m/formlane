# Testing strategy

## Scope and coordination

One integration owner runs authorized checks after shared edits land. Select explicit relevant test files and package typechecks; avoid overlapping installations, full builds, suites or watch processes. Delegated editing alone does not authorize verification. Test existence, historical screenshots and HTTP availability do not establish migrated production acceptance.

## Behavior boundaries

| Boundary             | Required coverage                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API/ownership        | Contract-compatible JSON/errors; preserved owner header; private project/chat/version/download isolation; explicit allowed/denied CORS origins                                           |
| Provider/CrewAI      | Flow stage order and halting, bounded repair loops, role-scoped tools, streaming, missing-key/provider failures and no mock fallback                                                     |
| PostgreSQL           | Explicit empty-database Alembic migration, constraints, atomic pointer/run transitions and concurrent lease fencing                                                                      |
| Generation           | Current-source build and check-set evidence; implementation and independent validation/review; repair, safe failure categories and prior-version preservation                            |
| Durability           | Cursor replay/deduplication, disconnect without cancellation, explicit cancel, lease expiry/reclaim, DBOS operation replay, stale late-write rejection and bounded individual operations |
| Source/compiler      | Cross-runtime source/hash fixtures, fixed templates, virtual imports, size/time/output bounds, stripped credentials and cancelled process cleanup                                        |
| Browser isolation    | Native sandboxed Chromium, opaque iframe, network/WebSocket denial, declarative interaction/assertions and repair evidence                                                               |
| Versions/publication | Monotonic numbering, inspection without mutation, restore, ancestry-based Undo, independent remix, exact ZIP, frozen publication, republish and unpublish                                |
| UI                   | Query invalidation, draft retention, localized errors, keyboard/focus behavior, desktop/mobile layout and SPA reload                                                                     |
| Static cutover       | Direct API origins, unchanged owner capability, old-client 307 method/body forwarding, public-link 302, SSE reconnect and origin-specific CORS                                           |

Use the lowest boundary that reproduces the behavior. Extend existing cases rather than mirroring implementation or asserting only mocked calls. Database behavior needs real PostgreSQL locks/transactions. Backend fixtures require `TEST_DATABASE_URL` and isolate schema state in a dedicated test database. Keep the remote `formlane_test` database separate from stage and production.

Backend tests live in [apps/backend/tests](../../apps/backend/tests/); compiler tests in [apps/compiler/src](../../apps/compiler/src/); frontend/package tests remain alongside their modules. Use named pytest files from the backend environment and guarded named JavaScript tests. Inject time where possible; intercepted model HTTP is deterministic boundary coverage, not real-provider acceptance.

Browser tests require a sandbox-capable Chromium/Chrome compatible with Python Playwright. Select it through `BROWSER_EXECUTABLE_PATH` when needed. Preserve non-root execution and the sandbox; on Ubuntu, account for the host's AppArmor/user-namespace policy instead of adding `--no-sandbox`. Compiler and browser descendants must lose provider/database credentials and terminate on cancellation.

## End-to-end evidence

A real-provider acceptance pass covers idea → plan/build/verify/review Flow → validated saved preview → follow-up → history/restore/Undo → remix/download → publish/republish/unpublish → reload. Separately exercise reconnect, cancellation, individual operation timeouts and restart/reclaim with the current deployed backend. Healthy execution and queue waiting have no whole-run deadline; long-running work must retain renewable lease authority. Record release, run/version identity and observed result; a successful tool probe is narrower evidence.

UI evidence checks actual rendering, both locales, dialogs/focus, status treatment, source comparisons, 375px layouts and unsent drafts. Generated apps may use their requested visual style; the shell retains Skyline.

[Deployment](../operations/deployment.md) owns current release identities, completed Python/PostgreSQL cutover evidence and cleanup verification. Record results against the exact candidate and database; historical targeted test counts do not establish acceptance of a later release. Distinguish an eventual green CI run from a fix for intermittent browser failures.
