# Lessons

Read before changing a related area. Entries distinguish observed migration mistakes from inherited engineering lessons; they do not claim unrelated reference-product incidents happened here.

## This migration

- **2026-11-10 — A `/p` Vite proxy also matched `/project` and broke direct reloads.** Match `/p/` and `/api/` explicitly; verify SPA route reloads separately from client-side navigation.
- **2026-11-10 — The mock document used browser storage inside an opaque iframe and never installed its event handlers.** Keep the sandbox isolated, use explicit session state for generated fixtures, and exercise actual Save/Add interactions instead of inferring success from dispatched clicks.

- **2026-11-10 — A prior deployment used the wrong Cloudflare account.** Select **Maqiqian0316@gmail.com's Account**, verify its ID and every bound resource, and obtain authorization before any remote mutation. A working historical hostname is not proof of the correct account.
- **2026-11-10 — Copying the repository skeleton left an incomplete baseline migration.** A workspace manifest is not enough: consumers must really use contract-first oRPC, shared Base UI components, the single catalog, and Drizzle D1. Remove obsolete code paths instead of retaining parallel implementations.
- **2026-11-10 — Copied context described the wrong product.** Transfer design tokens, progressive disclosure, and relevant engineering invariants; rewrite product terminology and remove unrelated business procedures. Preserve Atoms features rather than turning the reference's domain into new scope.

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
