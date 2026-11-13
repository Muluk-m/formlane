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

Use SQLAlchemy for ordinary PostgreSQL access and parameterize necessary SQL. Let constraints, transactions, row locks and conditional writes enforce uniqueness and current-run ownership. Apply schema changes through explicit Alembic migrations; requests and runtime startup never bootstrap schema.

Provider/browser execution belongs in the Python worker in `apps/backend`, separate from FastAPI requests. CrewAI Flow owns stage order and bounded repairs; DBOS records individual model/tool operations. Draft artifacts require current-source/artifact/check-set validation and independent review before commit. Stale, cancelled or lease-lost work cannot overwrite state. Enforce individual operation limits and renewable leases; runs have no fixed wall-clock deadline. SSE disconnect closes observation only; cancellation fences writes before the worker observes heartbeat rejection. Follow [ADR-0014](../adr/0014-dbos-node-recovery.md) for recovery and [ADR-0015](../adr/0015-flow-first-delivery.md) for orchestration. Preserve rollback compatibility where releases overlap.

## Browser

TanStack Router owns routes; TanStack Query/oRPC helpers own CRUD server state. Centralize query options and invalidation rather than calling a hand-written REST client from every component. SSE observes persisted run events and resumes by sequence cursor; it does not own producer execution.

Use shared Base UI primitives/composites and variants, not native replacement controls or local appearance overrides. Agent and conversation surfaces use assistant-ui through shared composites. Use Skyline tokens and Hugeicons at 1.5 stroke width. All visible text and accessible names come from the single catalog. Validate input with Zod, retain drafts on failed submission, and keep server errors understandable.

Generated HTML is untrusted. Maintain the sandbox and explicit viewed/current/published version distinctions. An error must not clear user input or the last complete preview.

## Shared code

Packages never import applications. Core stays runtime-independent; contracts own API shape; UI owns presentation; i18n owns copy. Keep dependency directions obvious and use explicit exported subpaths. Prefer existing patterns and a small direct implementation over unnecessary layers.

## Delivery checklist

Account for contract and both consumers, private/public visibility, initial/follow-up generation, cancellation/failure preservation, version operations, both locales, keyboard/loading/empty states, migrations, docs, and the actual checks exercised. Use [testing](testing.md) to select evidence; do not invent results for unrun checks.
