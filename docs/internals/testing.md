# Testing strategy

## Scope and coordination

One integration owner runs checks after shared edits land. Locally, use explicit relevant test files and package typechecks; avoid overlapping full builds, installations, suites, or watch processes. The guarded scripts enforce the configured execution policy. A delegated editing task does not imply permission to run checks.

Full verification belongs in the agreed CI/remote workflow or an explicitly authorized local run. No test result is claimed by this document. Historical screenshots and the existence of a test file are not evidence that the migrated build passes.

## Behavior worth testing

| Boundary             | Cases                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Core stream parsing  | Split fences, incomplete HTML, note/code separation, replacement deltas, complete-document extraction  |
| Explicit modes       | Mock protocol/persistence path, missing real key errors, no silent fallback                            |
| Ownership            | Another anonymous identity cannot read or mutate private project/chat/version/download data            |
| Generation lifecycle | Initial sequence, follow-up context, abort/failure, previous-version preservation, stale-run exclusion |
| Versions             | Monotonic project-local numbering, historical inspection, restore, source-independent remix            |
| Publication          | Explicit version pin, republish same link, restore without republish, unpublish, missing/invalid slug  |
| Database             | Migration from empty local D1, constraints, conditional/batched operations, schema consistency         |
| UI integration       | Query invalidation, field errors/input retention, navigation reload, accessible names, both locales    |
| Runtime              | Actual workerd behavior for streaming, bindings, provider aborts, generated HTML headers/sandbox       |

Test at the lowest boundary where a regression would fail. Extend an existing case/table when possible. Avoid assertions that only prove a mock function was invoked, duplicate type-system guarantees, or freeze incidental copy. Use real local D1 for database semantics rather than a mocked repository that cannot reproduce them.

Inject time where possible; avoid sleeps and polling as a substitute for deterministic state. Provider HTTP can be intercepted at the network boundary, but an intercepted response is not a real-provider acceptance run. Runtime-sensitive behavior needs local Wrangler/workerd evidence when verification is requested.

## Visual and end-to-end evidence

Visual changes need before/after browser screenshots, not markup-only tests. Inspect Base UI orientation, dialogs/focus, loading/status icons, narrow layouts, and the white/sky/black token treatment. Generated output may intentionally use a different theme.

An end-to-end pass exercises idea → streamed conversation/code → saved preview → follow-up → history/restore → remix/download → publish/republish/unpublish → reload. Run the path in explicit mock mode for reproducibility and, when credentials and authorization are available, in real mode for provider integration. Record which mode was exercised.

Public deployment acceptance is blocked until the designated Cloudflare account is accessible and verified; see [deployment](../operations/deployment.md). A local pass or a wrong-account public URL is not an authorized release.
