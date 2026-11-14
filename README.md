# Formlane

Describe an app and watch an AI product team build it: streamed conversation, editable source, an interactive preview and an optional published link. Emma and Bob plan requirements, architecture and acceptance checks; Alex implements; the browser validates; David independently reviews. Mike routes follow-ups and coordinates further source repairs or check corrections until the current candidate passes independent acceptance. Projects belong to an anonymous browser identity; there is no registered account system.

The architecture is **FastAPI + native CrewAI + DBOS + PostgreSQL on the existing GCP VM**, with **static React on Cloudflare Pages** and an isolated Node compiler. [Deployment evidence and recovery](docs/operations/deployment.md) record the migration, acceptance runs and release identities.

Open [formlane.nainma.online](https://formlane.nainma.online). The original [Pages hostname](https://formlane-9dp.pages.dev) remains available; anonymous ownership is local to each browser origin. Published examples include the [React counter](https://formlane.nainma.online/p/8tq3mrv54j) and [market app](https://formlane.nainma.online/p/7e2g3qqnnd), shown in an isolated full-screen viewer without navigating to the backend IP.

The [deployment record](docs/operations/deployment.md#current-rollout-status) identifies the active backend and frontend releases, with dated acceptance results and recovery instructions. Historical captures live in a private external archive; they do not establish acceptance of newer builds.

## Features

- English/Chinese interface, example prompts and this browser's project list.
- assistant-ui conversations with streaming Markdown, delegation tasks, grouped tool outcomes, review summaries and persistent prompt drafts.
- Resizable desktop workspace and full-height mobile conversation/preview switching.
- Sandboxed interactive preview, desktop/mobile sizes, selectable source files, live unsaved drafts and build results.
- Demand-selected Vanilla + Vite or React + TypeScript + Vite source projects; follow-ups preserve accepted behavior outside the requested change.
- Version history, current/published markers, historical preview, selectable source comparisons, confirmed restore and ancestry-based Undo.
- Publish, republish or unpublish a saved version at a stable link; remix a selected version and download complete runnable source.
- Durable generation: tab closure does not cancel; reconnect replays events; Resume continues the same eligible run from committed model/tool results without posting the original request again.

## Architecture

| Workspace                      | Responsibility                                                                                           |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `apps/web`                     | React/Vite, TanStack Router/Query, assistant-ui and direct typed API transport                           |
| `apps/backend`                 | FastAPI, PostgreSQL/SQLAlchemy, explicit Alembic migrations, durable native CrewAI worker and Playwright |
| `apps/compiler`                | Isolated trusted Node compiler for virtual source and fixed template dependencies                        |
| `packages/contracts`           | Shared oRPC/Zod wire contract consumed by the typed frontend and preserved by Python                     |
| `packages/atoms-core`          | Runtime-independent TypeScript types, templates, source validation/hashing and helpers                   |
| `packages/ui`, `packages/i18n` | Base UI/Hugeicons/Skyline controls, assistant-ui composites and the single bilingual catalog             |

The API and worker share PostgreSQL business state; DBOS owns durable workflow/operation history in its separate schema. Pages has no business Functions, Worker binding or database. The worker enforces fenced leases around native CrewAI model/tool execution; SSE observes persisted attempt-tagged events. Node owns no business endpoints or orchestration. See [architecture](docs/internals/architecture.md), [data model](docs/internals/data-model.md) and [ADRs](docs/adr/README.md).

A saved version requires a build for the current source, passing implementation checks, independent browser validation and David's explicit acceptance. Source/check changes invalidate affected evidence. Sandboxed Chromium validates opaque iframes with restricted networking and no provider/database credentials. Compiler subprocesses accept bounded virtual source without executing generated package scripts or plugins.

Runs have **no fixed wall-clock deadline or fixed repair-round limit**. Specialist turns, tool budgets and individual provider, compiler and browser operations remain bounded. A 60-second lease and 10-second heartbeat detect lost workers. Explicit Resume preserves run identity, source and committed results when the saved execution manifest matches the deployed runtime. Cancellation fences late writes. Interrupted operations without committed results may repeat, including provider billing. Completed, superseded, baseline-invalidated or runtime-incompatible runs cannot resume; failures retain accepted versions.

## Development

Use Node 24, the manifest-pinned pnpm and Python 3.13 with uv. Local generation needs PostgreSQL, a sandbox-capable Chromium/Chrome and real provider credentials. Follow the [setup guide](docs/operations/development.md#setup) to install dependencies, configure the private backend environment and apply both application and DBOS migrations.

Run these commands from the repository root in separate terminals after setup:

```bash
pnpm dev:api     # FastAPI on http://localhost:8090
pnpm dev:worker  # Build the compiler, then start the durable worker
pnpm dev        # Vite frontend on http://localhost:5173
```

The API queues requests; the worker executes them. Starting the frontend alone does not start generation. See [development](docs/operations/development.md) for origins and preview configuration, and [testing](docs/internals/testing.md) for focused checks and CI coverage.

## Deployment and limitations

The API uses the reserved GCP address `formlane-api` in `us-central1` on the existing `formlane-agent` VM. Caddy terminates HTTPS on 443 and proxies to loopback FastAPI; PostgreSQL is loopback-only. The old Node executor is disabled and D1 is retained as a frozen recovery snapshot. The provider remains `grok-4.7` at the existing compatible endpoint; secrets never enter frontend configuration. Exact accounts, service paths, isolated databases and recovery rules are in [deployment](docs/operations/deployment.md).

Generated projects are frontend applications with fixed template dependencies, bounded to 64 files/256 KiB of source and 512 KiB of compiled preview. The service does not provision generated backends, databases or authentication. Interactive state is in memory inside the opaque preview; saved source/history does not persist generated runtime state. Downloaded projects run with `pnpm install`, `pnpm dev` and `pnpm build`; React projects also support `pnpm typecheck`. The compiler supports local JS/TS/JSX/TSX, CSS, JSON and SVG with fixed React imports, not arbitrary server modules or custom Vite plugins.

Anonymous identity is a demo ownership boundary. Current, viewed and published versions remain distinct; restoring or undoing does not republish. Real-model runs can take minutes and vary with the request, provider and repair iterations; dated measurements belong to the [acceptance record](docs/operations/deployment.md#iterative-acceptance-activation-2026-11-13). Failed or cancelled runs preserve prior results. No GitHub export, visual editor or multi-model race is claimed.

[Documentation](docs/README.md) · [Terminology](CONTEXT.md) · [Design system](DESIGN.md) · [Agent guidance](AGENTS.md)
