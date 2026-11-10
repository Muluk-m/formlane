# @atoms-demo/core

Runtime-independent Atoms behavior shared by the browser and Worker. The directory name remains `atoms-core`; consumers use the `@atoms-demo/core` package name and explicit subpath exports.

- `/types`: project, message, version, and agent identities.
- `/html`, `/text`, `/alex-stream`: document extraction, text handling, and incremental separation of Alex's note from HTML.
- `/prompts`: provider prompt context. `apps/executor` owns SDK agents and role-scoped tool orchestration; there is no supported mock generator.

Keep this package independent of React, Hono, Wrangler bindings, database access and application imports. Provider transport belongs in `apps/executor`; D1 persistence belongs in `apps/server`. UI copy belongs in the shared i18n catalog rather than a second bilingual agent dictionary.

Parser changes must preserve chunk-boundary behavior: incomplete fences, split delimiters and revised note/code prefixes cannot leak HTML into chat. Parsing complete HTML alone does not authorize publication or completion: the executor requires current-artifact browser validation and independent acceptance, and the API fences persistence. Follow-up context preserves the existing app rather than replacing the requested edit with a canned page.

Read [architecture](../../docs/internals/architecture.md) for dependency direction, [ADR-0012](../../docs/adr/0012-durable-agent-harness.md) for harness boundaries, and [testing](../../docs/internals/testing.md) when choosing parser regression cases. The integration owner runs checks after shared edits settle.
