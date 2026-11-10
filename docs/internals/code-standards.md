# Code standards

## Review the complete path

For every behavior change, trace the user action through contract, server ownership/persistence, query invalidation, and rendered result. A renamed dependency or compiling wrapper is not evidence that the application consumes the intended baseline.

- Update every affected caller, saved-data interpretation, and test. Remove the superseded path instead of retaining a shim or duplicate implementation.
- Cover the inverse action: publish/unpublish, current/viewed selection, stop/retry, remix/source independence.
- Distinguish loading, empty, failed with previous output, and failed without output. Missing data is not zero or success.
- Preserve original Atoms features while adapting engineering structure. Extra retries, telemetry, abstractions, or business domains are not implicit scope.
- Keep docs/ADRs/design rules consistent with the implementation. Report only observed verification.

## Server

Routes parse, authorize, invoke a domain operation, and map errors. Ownership checks precede private reads and writes. Contract schemas and stable errors define the external boundary; frontend visibility is never authorization.

Use Drizzle for ordinary D1 access. Parameterize any necessary SQL; never interpolate untrusted strings. Let constraints and conditional writes enforce uniqueness/current-run ownership where relevant. D1 transaction semantics differ from PostgreSQL: use supported operations/batches and recheck predicates rather than assuming row locks exist.

Provider/browser execution belongs in `apps/executor`, outside the API Worker and database write batches. Draft artifacts require current-hash validation and independent review before commit. Stale, cancelled, lease-lost or deadline-expired work cannot overwrite state. SSE disconnect closes observation only; cancellation fences writes before the executor observes heartbeat rejection. Follow [ADR-0012](../adr/0012-durable-agent-harness.md) for immutable checkpoint and role-scoped tool boundaries. Migrations are explicit; requests do not bootstrap schema. Preserve rollback compatibility where releases overlap.

## Browser

TanStack Router owns routes; TanStack Query/oRPC helpers own CRUD server state. Centralize query options and invalidation rather than calling a hand-written REST client from every component. SSE observes persisted run events and resumes by sequence cursor; it does not own producer execution.

Use shared Base UI primitives/composites and variants, not native replacement controls or local appearance overrides. Use Skyline tokens and Hugeicons at 1.5 stroke width. All visible text and accessible names come from the single catalog. Forms use React Hook Form/Zod with server errors retained and understandable.

Generated HTML is untrusted. Maintain the sandbox and explicit viewed/current/published version distinctions. An error must not clear user input or the last complete preview.

## Shared code

Packages never import applications. Core stays runtime-independent; contracts own API shape; UI owns presentation; i18n owns copy. Keep dependency directions obvious and use explicit exported subpaths. Prefer existing patterns and a small direct implementation over unnecessary layers.

## Delivery checklist

Account for contract and both consumers, private/public visibility, initial/follow-up generation, cancellation/failure preservation, version operations, both locales, keyboard/loading/empty states, migrations, docs, and the actual checks exercised. Use [testing](testing.md) to select evidence; do not invent results for unrun checks.
