# Architecture

## System shape

Atoms Demo is a pnpm/Turbo monorepo with a React browser application and a Hono Cloudflare Worker. D1 stores project ownership, conversation, and HTML versions through Drizzle. There is no separate queue, extension, marketing application, or provisioned backend for generated apps.

```text
apps/web ──────────► packages/ui ─────► packages/i18n
   │                       └────────► Base UI / Hugeicons / Skyline
   ├──────────────► packages/contracts ◄──────── apps/server
   └──────────────► packages/atoms-core ◄─────── apps/server
                                                  │
                                         Drizzle / D1
                                                  │
                                    OpenAI-compatible provider
```

Packages never depend on applications. The web client imports contract types from contracts, not the server's inferred Hono app type. UI has no application persistence dependency. Core contains runtime-independent types/parsers/prompts/mock generation; provider transport and orchestration stay in the server.

## API and query boundary

CRUD is contract-first oRPC: Zod schemas and procedure metadata are shared; the server implements that contract and the web uses `createORPCClient`, `OpenAPILink`, and `createTanstackQueryUtils`. TanStack Query owns request caching/invalidation and Router owns navigation. React Hook Form/Zod owns editable form state and client validation, without duplicating server authority.

Generation and follow-up chat deliberately retain `/api/projects/:id/generate` and `/api/projects/:id/chat` SSE transport. Downloads and `/p/:slug` remain HTTP document endpoints. These are distinct transport needs, not a second generic CRUD client. Preserve abort handling and streamed errors while changing ordinary API plumbing.

## Initial build and follow-up

1. An owned project starts a generation request; ownership and active-run conditions are checked on the server.
2. Mike plans, Emma specifies, Bob designs, Alex generates HTML, and David suggests measurements. Follow-ups use Mike and Alex with the current HTML as context.
3. Each agent's text streams to the browser. Alex's note and document are separated by the core incremental parser.
4. Complete HTML is saved as a version and selected as current. Incomplete output or a failed run cannot replace a previous complete result.
5. The browser refreshes query-backed project/version state and presents the saved result. Publishing explicitly selects a saved version for a public slug.

Real and mock generation share this product path. Mock mode replaces the provider source, not persistence or publication, and is allowed only with `ENVIRONMENT=local`; deployed environments require a real provider. Runs are request-bound: this is not a durable background agent workflow, and reconnecting does not claim to resume a provider stream.

## Persistence and public boundary

Read [data-model.md](data-model.md) for pointer and ownership invariants. Local schema setup is an explicit migration step; requests do not auto-create tables. D1/SQLite behavior must be respected instead of importing row-lock or transaction assumptions from the reference PostgreSQL application.

Preview HTML is untrusted and sandboxed. Public HTML is served only through publication. Current, viewed, and published versions are separate concepts; browser state must not accidentally collapse them.

Project/chat/code/version persistence in D1 does not persist the generated application's interactive runtime state. The opaque-origin preview cannot rely on browser storage; the mock app keeps state only in memory for the current preview session.

## Inheritance scope

Preserved: workspace/package boundaries, strict shared TypeScript, targeted tooling, contract-first API, TanStack query/router conventions, form validation, complete base-nova primitives, reusable composites, Hugeicons, full Skyline token frontmatter, catalog-backed copy, and progressive documentation.

Adapted: Atoms-specific ownership, streaming agents, version history, publishing, core parsers, mock behavior, and D1 rather than PostgreSQL. Not inherited: unrelated business models, external account integrations, billing, or their deployment infrastructure. The source repository remains read-only.

Release topology and account verification belong to [deployment](../operations/deployment.md). No existing hostname is implied to be a verified deployment of this architecture.
