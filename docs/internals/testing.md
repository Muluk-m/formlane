# Testing strategy

## Scope and coordination

One integration owner runs checks after shared edits land. Locally, use explicit relevant test files and package typechecks; avoid overlapping full builds, installations, suites, or watch processes. The guarded scripts enforce the configured execution policy. A delegated editing task does not imply permission to run checks.

Full verification belongs in the agreed CI/remote workflow or an explicitly authorized local run. No test result is claimed by this document. Historical screenshots and the existence of a test file are not evidence that the migrated build passes.

## Behavior worth testing

| Boundary             | Cases                                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core stream parsing  | Split fences, incomplete HTML, note/code separation, replacement deltas, complete-document extraction                                               |
| Provider boundary    | Missing-key errors, real SDK tool delegation, visible provider failure, no mock fallback                                                            |
| Ownership            | Another anonymous identity cannot read or mutate private project/chat/version/download data                                                         |
| Generation lifecycle | Manager decisions, role-scoped tools, follow-up context, repair/review gate, persisted deadline, cancellation fences, previous-version preservation |
| Versions             | Monotonic project-local numbering, historical inspection, restore, source-independent remix                                                         |
| Publication          | Explicit version pin, republish same link, restore without republish, unpublish, missing/invalid slug                                               |
| Database             | Migration from empty local D1, constraints, conditional/batched operations, schema consistency                                                      |
| UI integration       | Query invalidation, field errors/input retention, navigation reload, accessible names, both locales                                                 |
| Runtime              | workerd control-plane/D1 behavior; Node 24 provider aborts, non-root systemd, native Chromium sandbox and credential isolation                      |
| Durable replay       | Cursor replay; lease expiry/reclaim; immutable checkpoint reuse after restart; stale-lease write rejection; bounded transient provider retry        |
| Browser validation   | Real state-changing checks, current artifact hash, independent acceptance, isolated context/network denial, failed checks returning repair evidence |

Test at the lowest boundary where a regression would fail. Extend an existing case/table when possible. Avoid assertions that only prove a mock function was invoked, duplicate type-system guarantees, or freeze incidental copy. Use real local D1 for database semantics rather than a mocked repository that cannot reproduce them.

Inject time where possible; avoid sleeps and polling as substitutes for deterministic state. Intercepted provider HTTP is not real-provider acceptance. Runtime-sensitive verification must target the relevant runtime: Wrangler/workerd for the API/D1 control plane, Node 24 and native Chromium for executor behavior.

Executor browser regression tests require a sandbox-capable Chromium installation. CI installs system Chrome with `pnpm --filter @atoms-demo/executor exec playwright install --with-deps chrome` and passes `CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome` through Turbo. Ubuntu's AppArmor profile permits the standard Chrome binary to create user namespaces; the downloaded Playwright binary is not covered by that profile. See [Chromium's AppArmor guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md). Run focused checks with `pnpm --filter @atoms-demo/executor test src/validator.browser.test.ts`, selecting an installed browser with `CHROMIUM_EXECUTABLE_PATH` if needed. The regression exercises containment, exact non-text matching, fresh check state, and real DOM interactions. Run as a non-root account with the Chromium sandbox enabled.

## Visual and end-to-end evidence

Visual changes need before/after browser screenshots, not markup-only tests. Inspect Base UI orientation, dialogs/focus, loading/status icons, narrow layouts, and the white/sky/black token treatment. Generated output may intentionally use a different theme.

An end-to-end pass exercises idea → manager delegation → browser-validated saved preview → follow-up → history/restore → remix/download → publish/republish/unpublish → reload. Use the real configured provider; there is no product mock mode. Separately exercise disconnect/reconnect, explicit cancellation, persisted deadline enforcement and a validation failure repaired before independent acceptance. Record deployed build, run identity and actual evidence; provider test interception is not deployed acceptance.

Public acceptance requires the designated verified Cloudflare account, the separately approved GCP executor target and authorization; see [deployment](../operations/deployment.md). A local pass, historical screenshot or wrong-account URL is not current release evidence.
