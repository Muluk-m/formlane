# @atoms-demo/core

Runtime-independent Atoms behavior shared by the TypeScript browser and compiler. The directory name remains `atoms-core`; consumers use `@atoms-demo/core` and its explicit exports.

- `/types`: project, chat message, version and agent identities.
- `/project`: source/template types, source limits and normalization, templates, and canonical source serialization/hashing.
- `/html`: UUID and slug helpers.
- `/text`: language detection and project-title helpers.
- The root export re-exports these four modules.

Keep this package independent of React, database access and application imports. Python provider orchestration and PostgreSQL persistence belong in `apps/backend`; Node compilation belongs in `apps/compiler`. UI copy belongs in the shared i18n catalog.

Source normalization and hashing must stay compatible with the Python project representation. Current-source build, validation and independent acceptance are enforced by the backend before persistence; parsing or hashing alone cannot establish completion.

Read [architecture](../../docs/internals/architecture.md) for dependency direction and [testing](../../docs/internals/testing.md) when choosing source/hash regression coverage. The integration owner runs checks after shared edits settle.
