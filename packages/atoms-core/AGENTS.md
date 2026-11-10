# @atoms-demo/core

Runtime-independent Atoms behavior shared by the browser and Worker. The directory name remains `atoms-core`; consumers use the `@atoms-demo/core` package name and explicit subpath exports.

- `/types`: project, message, version, and agent identities.
- `/html`, `/text`, `/alex-stream`: document extraction, text handling, and incremental separation of Alex's note from HTML.
- `/agents`, `/prompts`, `/mock`: persona metadata, provider prompts, and explicit mock behavior.

Keep this package independent of React, Hono, Wrangler bindings, database access, and application imports. Provider transport and persistence belong in the server; UI copy belongs in the shared i18n catalog rather than a second bilingual agent dictionary.

Parser changes must preserve chunk-boundary behavior: incomplete fences, split delimiters, and revised note/code prefixes cannot leak HTML into chat or publish incomplete output. A mock result follows the same stream shape but must not pretend a real model was called. Follow-up prompts preserve the existing app rather than silently replacing the requested edit with a canned page.

Read [architecture](../../docs/internals/architecture.md) for dependency direction and [testing](../../docs/internals/testing.md) when choosing parser or mock regression cases. Extend the existing core pipeline test where it covers the changed behavior; the integration owner runs checks after shared edits settle.
