# ADR 0009: Contract-first CRUD with explicit streaming endpoints

Status: accepted, 2026-11-10; Python backend compatibility clarified for the cutover.

## Context

The migration must genuinely consume a shared contract, not just install oRPC while retaining a parallel hand-written CRUD client. Atoms also depends on streamed agent/code events, cancellation, HTML downloads, and public documents.

## Decision

`@atoms-demo/contracts` exports the oRPC contract and Zod boundary schemas. The browser uses `createORPCClient` with `OpenAPILink` and `createTanstackQueryUtils` for CRUD/query integration. FastAPI implements the compatible HTTP routes, JSON shapes and safe errors; Python does not import TypeScript schemas. Update both boundaries together and keep frontend types independent of server application imports.

Keep explicit run-start, run-event SSE, cancellation, authenticated download and public `/p/:slug` endpoints where semantics differ from ordinary CRUD. Generation starts a durable PostgreSQL run and SSE observes persisted events produced by the native CrewAI worker. The browser sends its unchanged `atoms_uid` capability as `x-owner-id` to the configured API origin; public links use the configured document origin. These transports do not justify a second CRUD client.

## Consequences

API changes update the contract and both consumers together, including error-to-catalog mapping and query invalidation. Private operations remain owner-authorized. SSE disconnect closes observation, not execution; explicit cancel fences writes. Only browser-validated, independently accepted current artifacts reach the saved-version boundary.
