# Development

## Setup and local execution

Work in `/Users/qiqian/Projects/Self/atoms-demo`. Read Node `engines` and `packageManager` in the root manifest before installing; use its pinned pnpm, including on remote machines. Do not produce an npm lockfile or use reference-repository node_modules as a dependency contract.

```sh
pnpm install
cp apps/server/.dev.vars.example apps/server/.dev.vars
pnpm db:migrate
pnpm dev
```

The server workspace is Wrangler's working directory; its local configuration lives in `apps/server/.dev.vars`. Configure the control-plane `EXECUTOR_TOKEN` there, not model execution credentials. `pnpm db:migrate` applies local D1 migrations; never change it to `--remote` as a shortcut. Model execution runs separately in `apps/executor` on Node 24 with native Chromium and environment variables `OPENAI_API_KEY`, `ENDPOINT`, `MODEL`, `EXECUTOR_TOKEN` and `CONTROL_PLANE_URL`. The URL must use HTTPS and the token must match the target API. Never commit or log secrets. No Workflow/browser bindings or mock generation are required or supported by this execution path. Local UI startup alone does not establish generation acceptance.

`pnpm dev` uses Turbo to coordinate the web and Worker tasks. Start only one instance of each service; `dev:web` / `dev:server` are separate entry points when needed. The web development proxy sends API/public requests to the Worker, preserving the browser's same-origin ownership behavior. Read the Vite and Wrangler configurations for ports and routes instead of duplicating configuration here.

## Dependencies and shared code

- Read the installed package declaration for new API usage. Base UI, TanStack Table, oRPC, and Zod must follow the selected major versions.
- Changes to API shapes begin in contracts, then update server and web. Runtime-independent helpers belong in core; SDK agents, scoped tools, native browser validation and checkpoint orchestration belong in `apps/executor`. D1 persistence and lease authorization belong in `apps/server`.
- All visible copy uses the single i18n catalog. All product controls use UI. Feature-specific composition stays in the web application.
- Drizzle schema and SQL migrations move together. Local D1 and deployment bindings are distinct configurations.
- Preserve migration history through `0005_project_sources.sql`. Apply the source snapshot migration before starting a source-aware API/executor, with old runs drained and old executors stopped. Generate Worker binding types with the server's `cf:typegen` script when bindings change. Read [ADR-0012](../adr/0012-durable-agent-harness.md) before changing durable execution.

## Checks and resource use

Use the smallest check that answers the question: a named core/parser test, component test, package typecheck, or changed-file gate. Root scripts are authoritative for exact behavior. Guarded test commands require explicit files locally and avoid watch mode; CI/full verification is coordinated, not launched separately by every agent.

```sh
pnpm --filter @atoms-demo/core test test/pipeline.test.ts
pnpm --filter @atoms-demo/ui test src/composites/status-badge.test.tsx
pnpm --filter @atoms-demo/web typecheck
pnpm check:changed
```

These are examples to run when verification is authorized, not evidence of a successful run. Full install/build/test work should have a single owner, especially on shared machines. Do not copy ignored secret files to a remote workspace; file synchronization may not respect gitignore.

## Branches and delivery

Use an isolated feature branch/worktree when another session owns changes. Preserve uncommitted work; do not blanket-stage, reset, or commit another agent's files. The integration owner commits each completed coherent module using a brief English Conventional Commit, after shared edits and agreed checks settle. Delegated editors leave commits to that owner. Pushes and deployments require separate authorization; no reference-project branch-to-production automation is assumed here.

A handoff identifies affected behavior, exercised checks, and blockers. UI screenshots must show the actual build under review. Historical screenshots remain a feature reference, not new visual evidence.
