# Documentation

[AGENTS.md](../AGENTS.md) is the agent entry point. Read the branch relevant to the task.

| Task                                                                  | Document                                      |
| --------------------------------------------------------------------- | --------------------------------------------- |
| Setup and focused local work                                          | [Development](operations/development.md)      |
| Current rollout status, cloud identities, import, release or recovery | [Deployment](operations/deployment.md)        |
| Streaming, runtime, preview or data failures                          | [Debugging](operations/debugging.md)          |
| FastAPI/CrewAI/PostgreSQL and static Pages boundaries                 | [Architecture](internals/architecture.md)     |
| Ownership, six-table authority, ancestry and publication              | [Data model](internals/data-model.md)         |
| Behavior checks and evidence limits                                   | [Testing](internals/testing.md)               |
| End-to-end delivery conventions                                       | [Code standards](internals/code-standards.md) |
| Decision history and superseded backend choices                       | [ADRs](adr/README.md)                         |

Root references: [README](../README.md) describes the product, [CONTEXT](../CONTEXT.md) defines terminology, [DESIGN](../DESIGN.md) specifies Skyline and [LESSONS](../LESSONS.md) records recurring failures. Existing [screenshots](screenshots/) are historical product evidence, not proof that the Python production cutover passed.

Keep current operational state in the deployment guide and mark historical releases explicitly. Source/configuration remain authoritative for mechanically discoverable details. Record decisions and non-obvious constraints without maintaining competing copies of schemas or commands.
