# Testing strategy

## Scope and coordination

One integration owner runs authorized checks after shared edits land. Select explicit relevant test files and package typechecks; avoid overlapping installations, full builds, suites or watch processes. Delegated editing alone does not authorize verification. Test existence, historical screenshots and HTTP availability do not establish migrated production acceptance.

## Behavior boundaries

| Boundary             | Required coverage                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API/ownership        | Contract-compatible JSON/errors; preserved owner header; private project/chat/version/download isolation; explicit allowed/denied CORS origins                                             |
| Provider/CrewAI      | Focused native stage execution, scoped tools, streaming, capability contracts, missing-key/provider failures and no mock fallback                                                          |
| PostgreSQL           | Explicit empty-database Alembic migration, constraints, atomic pointer/run transitions and concurrent lease fencing                                                                        |
| Import               | All six tables; IDs/timestamps/pointers, source/HTML hashes, message order, event cursors, checkpoints, pre-0006 ancestry policy, exact repeat and divergent-target rejection, verify-only |
| Generation           | Current-source build and check-set evidence; implementation and independent validation/review; repair, safe failure categories and prior-version preservation                              |
| Durability           | Cursor replay/deduplication, disconnect without cancellation, cancel/reclaim, granular replay, stale-write rejection and incompatible-history isolation                                    |
| Source/compiler      | Cross-runtime source/hash fixtures, fixed templates, virtual imports, size/time/output bounds, stripped credentials and cancelled process cleanup                                          |
| Browser isolation    | Native sandboxed Chromium, opaque iframe, network/WebSocket denial, declarative interaction/assertions and repair evidence                                                                 |
| Versions/publication | Monotonic numbering, inspection without mutation, restore, ancestry-based Undo, independent remix, exact ZIP, frozen publication, republish and unpublish                                  |
| UI                   | Query invalidation, draft retention, localized errors, keyboard/focus behavior, desktop/mobile layout and SPA reload                                                                       |
| Static cutover       | Direct API origins, unchanged owner capability, old-client 307 method/body forwarding, public-link 302, SSE reconnect and origin-specific CORS                                             |

Use the lowest boundary that reproduces the behavior. Extend existing cases rather than mirroring implementation or asserting only mocked calls. Database behavior needs real PostgreSQL locks/transactions; SQLite is only an offline legacy-export decoder. Backend fixtures require `TEST_DATABASE_URL` and isolate schema state in a dedicated test database. Keep the remote `formlane_test` database separate from stage and production.

Backend tests live in [apps/backend/tests](../../apps/backend/tests/); compiler tests in [apps/compiler/src](../../apps/compiler/src/); frontend/package tests remain alongside their modules. Use named pytest files from the backend environment and guarded named JavaScript tests. Inject time where possible; intercepted model HTTP is deterministic boundary coverage, not real-provider acceptance.

Browser tests require a sandbox-capable Chromium/Chrome compatible with Python Playwright. Select it through `BROWSER_EXECUTABLE_PATH` when needed. Preserve non-root execution and the sandbox; on Ubuntu, account for the host's AppArmor/user-namespace policy instead of adding `--no-sandbox`. Compiler and browser descendants must lose provider/database credentials and terminate on cancellation.

## End-to-end evidence

A real-provider acceptance pass covers idea → frozen capabilities → implementation → validated saved preview → behavior-preserving follow-up → reconnect. Retained-candidate inspection must preserve accepted history and publication. Separately exercise process death, same-run resume and cancellation. Required runtime capabilities must fail honestly when unavailable; an explicitly session-only acceptance case does not establish persistent shared business data. Record release, run/version identity and observed result; passing test doubles do not establish real-provider quality.

UI evidence checks actual rendering, both locales, dialogs/focus, status treatment, source comparisons, 375px layouts and unsent drafts. Generated apps may use their requested visual style; the shell retains Skyline.

[Deployment](../operations/deployment.md) owns current acceptance evidence and rollout status. Historical test counts or screenshots do not prove the current workflow or production activation.
