# ADR 0009: Contract-first CRUD with explicit streaming endpoints

Status: accepted, 2026-11-10.

## Context

The migration must genuinely consume a shared contract, not just install oRPC while retaining a parallel hand-written CRUD client. Atoms also depends on streamed agent/code events, cancellation, HTML downloads, and public documents.

## Decision

`@atoms-demo/contracts` exports the oRPC contract and Zod boundary schemas. The server implements that contract. The browser uses `createORPCClient` with `OpenAPILink` and `createTanstackQueryUtils` for CRUD/query integration. Do not infer frontend API types from an application server import.

Preserve `/api/projects/:id/generate` and `/api/projects/:id/chat` SSE transport, authenticated downloads, and public `/p/:slug` documents. These explicit transports serve different response semantics; they are not an excuse to duplicate ordinary CRUD routing or schemas.

## Consequences

API changes update the contract and both consumers together, including error-to-catalog mapping and query invalidation. Private operations remain owner-authorized on the server. SSE retains its abort/error behavior and only complete HTML reaches the saved-version boundary.
