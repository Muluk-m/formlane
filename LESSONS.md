# Lessons

Read before changing a related area. Entries distinguish observed migration mistakes from inherited engineering lessons; they do not claim unrelated reference-product incidents happened here.

## This migration

- **2026-11-11 — CI stalled on an unnecessary browser dependency install.** The GitHub Ubuntu runner already provides Google Chrome, and executor tests use that binary explicitly. Running Playwright's dependency installer first made the checks depend on Ubuntu mirror DNS and failed before any tests ran. Verify the installed Chrome executable, then run the unchanged browser tests; do not disable sandboxing or skip them.

- **2026-11-11 — Tool-call generation was invisible until the tool executed.** Forwarding only ordinary model text left the code pane empty while `write_artifact` HTML arguments streamed. Observe the installed SDK's real argument events before Runner executes the tool; preserve JSON chunk boundaries and keep draft observation separate from workspace acceptance. Test actual Runner ordering, cancellation, escapes, and final-artifact deduplication.

- **2026-11-11 — assistant-ui clears a draft before the host accepts it.** A plain rejected project-creation promise left the homepage input empty. Reject failed submissions with `MessageNotSentError` so the runtime restores the draft, and exercise the visible input after an actual browser error response.

- **2026-11-11 — Retry displayed a stale project failure beside an active run.** Project details and run observations refresh independently. Once a current run is known, its lifecycle is authoritative for generation errors; do not combine it with a cached failure from an older run. Keep transport and action failures separately visible.

- **2026-11-11 — Text acceptance disagreed with its polling condition.** Polling accepted contained text, but the final verdict still required equality, so `Saved Ada` failed an expectation of `Saved`. Reuse the match result and exercise the real browser path. Reducing model turn limits or changing prompts does not fix false validation failures; use SDK tool termination for completed specialist work.

- **2026-11-10 — A `/p` Vite proxy also matched `/project` and broke direct reloads.** Match `/p/` and `/api/` explicitly; verify SPA route reloads separately from client-side navigation.
- **2026-11-10 — Historical scaffold storage failure:** an earlier mock document used browser storage inside an opaque iframe and never installed its event handlers. That generator is obsolete; retain the lesson, not a mock execution path. Keep generated apps isolated and exercise real state-changing interactions rather than inferring success from dispatched clicks.

- **2026-11-10 — A prior deployment used the wrong Cloudflare account.** Select **Maqiqian0316@gmail.com's Account**, verify its ID and every bound resource, and obtain authorization before any remote mutation. A working historical hostname is not proof of the correct account.
- **2026-11-10 — Copying the repository skeleton left an incomplete baseline migration.** A workspace manifest is not enough: consumers must really use contract-first oRPC, shared Base UI components, the single catalog, and Drizzle D1. Remove obsolete code paths instead of retaining parallel implementations.
- **2026-11-10 — Copied context described the wrong product.** Transfer design tokens, progressive disclosure, and relevant engineering invariants; rewrite product terminology and remove unrelated business procedures. Preserve Atoms features rather than turning the reference's domain into new scope.
- **2026-11-10 — Request-bound generation was not durable execution.** The predecessor's fixed persona sequence and 120-second abort conflated disconnect, timeout and cancellation. [ADR-0012](docs/adr/0012-durable-agent-harness.md) replaces it with SDK delegation, D1 checkpoints/events and leases, a persisted 15-minute deadline and fenced cancellation. HTML parsing alone is not acceptance: require actual browser evidence for the current artifact and independent review.
- **2026-11-10 — Cloudflare Free CPU killed validator execution.** Moving a long-running tool loop into Workflows did not remove the observed 10 ms Worker CPU constraint. The user approved GCP Node/native-Playwright compute while preserving the personal-account Cloudflare API/D1/Pages control plane. Keep per-cloud identity, trial-cost approval and runtime evidence separate; do not silently upgrade billing or disable Chromium's sandbox.

## Inherited engineering lessons

- **Base UI orientation:** base-nova styles use `data-horizontal` / `data-vertical`, while Base UI emits `data-orientation`. Keep the shared CSS custom variants. A successful typecheck does not prove correct visual layout.
- **Dependency APIs:** inspect installed declarations before writing code. Base UI uses `render`, not Radix `asChild`; TanStack and oRPC APIs must match the installed release.
- **Design frontmatter:** preserve nested YAML indentation and keep generic Markdown formatters away from DESIGN.md if they flatten frontmatter. Token parsing must be checked explicitly when requested.
- **Runtime evidence:** Node tests cannot establish Workers compatibility. Runtime-sensitive changes need a local workerd smoke test as part of authorized verification.
- **Shared machines:** independent agents must not each launch full suites or installs. One integration owner runs the agreed checks after edits settle; stop only processes you started.
- **State preservation:** failed reads, parse failures, and interrupted streams mean unknown/incomplete, not empty success. Keep the last complete HTML and distinguish it visibly from the current attempt.
- **One design/copy source:** local component styling and duplicate locale dictionaries drift. Put reusable variants in UI, copy in i18n, and application layout in the application.
- **Shared checkout:** another session may own dirty files or staged changes. Avoid blanket staging, branch switching, or destructive cleanup; use an isolated worktree for independently committed work.
- **Evidence:** a check's exit status and full conclusion matter. Do not report a build, browser pass, migration, or deployment that was not actually exercised.
