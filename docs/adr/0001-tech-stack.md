# ADR 0001: Atoms monorepo engineering baseline

Status: accepted, 2026-11-10.

## Context

Atoms began as a single-package browser/Worker demo. The requested migration inherits the reference repository's engineering conventions without changing the product into the reference's business domain.

## Decision

Use pnpm workspaces and Turbo with `apps/web`, `apps/server`, and shared contracts, UI, i18n, and runtime-independent core packages under the `@atoms-demo/*` namespace. Keep strict shared TypeScript, including `noUncheckedIndexedAccess`, and targeted Biome/test tooling.

The browser uses React/Vite, TanStack Router/Query, and React Hook Form/Zod. The Worker uses Hono with contract-first oRPC and Drizzle D1. UI uses the complete shadcn base-nova/Base UI component family, Hugeicons, and Skyline. Exact dependency versions belong in manifests/lockfile, not this document.

## Consequences

Shared packages never import applications. API types do not originate from server implementation imports. Pure parsing/prompts/mock behavior can be consumed by both runtimes without React or database dependencies. The original idea/generation/version/publication loop remains the acceptance boundary; a monorepo skeleton alone does not complete the migration.

Related: [UI](0002-shadcn-only-ui.md), [oRPC](0009-orpc-contract-first.md), [D1](0010-server-on-workers.md), [i18n](0011-i18n-catalog.md).
