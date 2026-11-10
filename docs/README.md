# Documentation

The root [AGENTS.md](../AGENTS.md) is the always-loaded entry; this index discloses context by task. Read the relevant branch, not every document.

## Operations: doing the work

| Task                                       | Document                                 |
| ------------------------------------------ | ---------------------------------------- |
| Setup, development, focused checks         | [Development](operations/development.md) |
| Account verification, migration, release   | [Deployment](operations/deployment.md)   |
| Streaming, runtime, preview, data failures | [Debugging](operations/debugging.md)     |

## Internals: understanding the system

| Question                                                       | Document                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| Boundaries, data flow, inherited baseline                      | [Architecture](internals/architecture.md)                     |
| End-to-end delivery rules                                      | [Code standards](internals/code-standards.md)                 |
| What to test and where                                         | [Testing](internals/testing.md)                               |
| Ownership, versions, publication, D1                           | [Data model](internals/data-model.md)                         |
| Why a technology or trade-off was selected                     | [ADRs](adr/README.md)                                         |
| Agent delegation, browser repair, durable run/replay semantics | [Durable harness decision](adr/0012-durable-agent-harness.md) |

Root references: [README](../README.md) for the product, [CONTEXT](../CONTEXT.md) for terminology, [DESIGN](../DESIGN.md) for the full Skyline system, and [LESSONS](../LESSONS.md) for recurring failures. Existing [screenshots](screenshots/) are historical product evidence, not proof that the current migrated UI was verified.

Document decisions, cross-module constraints, and non-obvious failure modes. Scripts, types, and configuration remain authoritative for mechanically discoverable facts. Rewrite stale guidance instead of appending contradictory layers. Product-specific documents from the reference repository are intentionally not inherited.
