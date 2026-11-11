# Architecture

## System shape

Atoms Demo is a pnpm/Turbo monorepo with a React browser application, Hono Cloudflare control-plane Worker and Node 24 GCP executor. D1 stores ownership, conversation, versions, runs, events, leases and checkpoints through Drizzle. `apps/executor` runs OpenAI Agents SDK and native Playwright as a non-root systemd service. Generated apps have no provisioned backend. The earlier Workflows/browser-binding execution was superseded after the Free Worker CPU limit killed validation.

```text
apps/web ──────────► packages/ui ─────► packages/i18n
   │                       └────────► Base UI / Hugeicons / Skyline
   ├──────────────► packages/contracts ◄──────── apps/server
   └──────────────► packages/atoms-core ◄─────── apps/server
                                                  │
                                             Drizzle / D1
                                                  ▲
apps/executor ── authenticated control-plane API ───┘
   ├──────────────► OpenAI Agents SDK / provider
   └──────────────► Native Playwright / Chromium
```

Packages never depend on applications. The web imports contract types from contracts, not inferred server types. UI has no persistence dependency. Core contains runtime-independent helpers; `apps/executor` owns provider transport, SDK agents, tools and checkpoint orchestration. `apps/server` owns D1 persistence and authenticated lease/control-plane operations.

## API and query boundary

CRUD is contract-first oRPC: Zod schemas and procedure metadata are shared; the server implements that contract and the web uses `createORPCClient`, `OpenAPILink`, and `createTanstackQueryUtils`. TanStack Query owns request caching/invalidation and Router owns navigation. assistant-ui owns conversation drafts and submission; Zod validates input without duplicating server authority.

Generation and follow-up requests start durable runs and return run identity. The browser observes a separate owned run-event SSE endpoint, replaying from `after` or `Last-Event-ID`. Disconnect aborts only observation. Downloads and `/p/:slug` remain HTTP document endpoints, not a second generic CRUD client.

## Initial build and follow-up

1. An owned project queues a D1 run with an active-run fence and persisted 15-minute deadline. The VM polls `/internal/executor`, claims a 60-second lease and heartbeats every 10 seconds; no public VM application port is required.
2. Mike selects a specialist through schema-validated SDK decision tools. Manager decisions and specialist turns have separate durable checkpoints. Emma defines scope, Bob architecture, Alex implementation/repair, and David independent review; this is not a fixed persona-completion pipeline.
3. Specialists use role-scoped tools. Planning roles read the workspace; Alex reads/writes/validates; David reads/validates/records acceptance. Actual specialist results inform the next manager decision.
4. Native Playwright validates each check in a fresh context and opaque iframe. Sandboxed Chromium receives no provider/control-plane credentials; restrictive CSP, HTTP/WebSocket blocking and disabled service workers/downloads isolate candidates. Restricted click/fill and exact text/value/count checks produce repair evidence, not arbitrary privileged executor JavaScript.
5. Only passing validation for the current artifact hash plus explicit David acceptance permits a version commit. Failure, cancellation or deadline expiry preserves the last complete version.
6. D1 events carry sequence cursors for browser replay. Cancellation fences writes and the executor aborts on loss of heartbeat authority. Expired leases can be reclaimed; immutable named checkpoint results resume completed steps, while interrupted calls may repeat. The UI refreshes saved state on completion. Publication remains explicit.

Execution is real-provider only, with visible errors for missing credentials. Checkpoints can replay in-flight specialist calls; event identities are idempotent, but provider billing is not exactly-once. [ADR-0012](../adr/0012-durable-agent-harness.md) defines the durable harness decision and its evidence limits.

Draft HTML is observed at the SDK model boundary while `write_artifact` arguments are still arriving. The incremental JSON reader emits `code_start` and `code` before tool execution; only the fully parsed, schema-validated tool call updates the workspace. Retry resets the visible draft to the durable workspace, and final reconciliation replaces rather than duplicates partial text. A draft is never a saved version or a publishable preview.

Only explicitly public provider reasoning-summary events become `reasoning_summary` records. The configured Chat Completions provider has no supported public summary, so the interface shows actual delegation tasks and tool evidence without synthesizing reasoning or exposing raw model reasoning.

## Persistence and public boundary

Read [data-model.md](data-model.md) for pointer and ownership invariants. Local schema setup is an explicit migration step; requests do not auto-create tables. D1/SQLite behavior must be respected instead of importing row-lock or transaction assumptions from the reference PostgreSQL application.

Preview HTML is untrusted and sandboxed. Public HTML is served only through publication. Current, viewed, and published versions are separate concepts; browser state must not accidentally collapse them.

Project/chat/code/version persistence in D1 does not persist the generated application's interactive runtime state. The opaque-origin preview cannot rely on browser storage; generated apps use in-memory state for the preview session.

## Inheritance scope

Preserved: workspace/package boundaries, strict shared TypeScript, targeted tooling, contract-first API, TanStack query/router conventions, form validation, complete base-nova primitives, reusable composites, Hugeicons, full Skyline token frontmatter, catalog-backed copy, and progressive documentation.

Adapted: Atoms-specific ownership, streaming observation, version history, publishing, core parsers, and D1 rather than PostgreSQL. The original fixed pipeline and local mock scaffold are historical origins only. Not inherited: unrelated business models, external account integrations, billing, or their deployment infrastructure. The source repository remains read-only.

Release topology and account verification belong to [deployment](../operations/deployment.md). No existing hostname is implied to be a verified deployment of this architecture.
