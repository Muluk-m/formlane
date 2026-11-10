# ADR 0009: Contract-first CRUD with explicit streaming endpoints

Status: accepted, 2026-11-10.

## Context

The migration must genuinely consume a shared contract, not just install oRPC while retaining a parallel hand-written CRUD client. Atoms also depends on streamed agent/code events, cancellation, HTML downloads, and public documents.

## Decision

`@atoms-demo/contracts` exports the oRPC contract and Zod boundary schemas. The server implements that contract. The browser uses `createORPCClient` with `OpenAPILink` and `createTanstackQueryUtils` for CRUD/query integration. Do not infer frontend API types from an application server import.

Keep explicit run-start, run-event SSE, cancellation, authenticated download and public `/p/:slug` endpoints where their semantics differ from ordinary CRUD. [ADR-0012](0012-durable-agent-harness.md) supersedes the original request-owned generation/chat streams: generation starts a durable run and SSE observes its persisted events. These transports are not an excuse to duplicate CRUD routing or schemas.

## Consequences

API changes update the contract and both consumers together, including error-to-catalog mapping and query invalidation. Private operations remain owner-authorized. SSE disconnect closes observation, not execution; explicit cancel fences writes. Only browser-validated, independently accepted current artifacts reach the saved-version boundary.
