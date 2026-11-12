# ADR 0001: Atoms monorepo engineering baseline

Status: accepted baseline, 2026-11-10; backend runtime/storage superseded by the Python cutover decision in the [ADR index](README.md).

## Context

Atoms began as a single-package browser/Worker demo. The requested migration inherits the reference repository's engineering conventions without changing the product into the reference's business domain.

## Decision

Use pnpm workspaces and Turbo for `apps/web`, the isolated `apps/compiler` and shared contracts, UI, i18n and runtime-independent core under the `@atoms-demo/*` namespace. Keep strict shared TypeScript, including `noUncheckedIndexedAccess`, and targeted Biome/test tooling. `apps/backend` uses Python/uv, FastAPI, native CrewAI, SQLAlchemy/PostgreSQL and explicit Alembic migrations.

The browser retains React/Vite, TanStack Router/Query and React Hook Form/Zod. Pages is static only. The Python API preserves the shared oRPC wire contract; Node is restricted to trusted preview compilation. UI retains shadcn base-nova/Base UI, Hugeicons and Skyline. Exact dependency versions belong in manifests/lockfiles.

## Consequences

Shared packages never import applications. API types do not originate from server implementation imports. Pure TypeScript helpers remain runtime-independent, with Python source/hash parity maintained at the language boundary. The original idea/generation/version/publication loop remains the acceptance boundary. PostgreSQL owns all six business tables; the durable runner preserves the acceptance and replay invariants of [ADR-0012](0012-durable-agent-harness.md).

Related: [UI](0002-shadcn-only-ui.md), [contract](0009-orpc-contract-first.md), [historical D1 decision](0010-server-on-workers.md), [i18n](0011-i18n-catalog.md), [current architecture](../internals/architecture.md).
