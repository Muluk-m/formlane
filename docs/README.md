# Documentation

Start with the [project README](../README.md) for capabilities and limitations, then [Development](operations/development.md#setup) to run the frontend, API and worker locally. [AGENTS.md](../AGENTS.md) is the coding-agent entry point.

| Task                                                                  | Document                                      |
| --------------------------------------------------------------------- | --------------------------------------------- |
| Setup and focused local work                                          | [Development](operations/development.md)      |
| Current rollout status, cloud identities, import, release or recovery | [Deployment](operations/deployment.md)        |
| Streaming, runtime, preview or data failures                          | [Debugging](operations/debugging.md)          |
| FastAPI/CrewAI Flow, DBOS recovery and static Pages boundaries        | [Architecture](internals/architecture.md)     |
| Ownership, six-table authority, ancestry and publication              | [Data model](internals/data-model.md)         |
| Behavior checks and evidence limits                                   | [Testing](internals/testing.md)               |
| End-to-end delivery conventions                                       | [Code standards](internals/code-standards.md) |
| Decision history and superseded backend choices                       | [ADRs](adr/README.md)                         |
| Flow stage policy, iteration and acceptance decisions                 | [ADR-0015](adr/0015-flow-first-delivery.md)   |
| External workflow research behind ADR-0015                            | [Research](research/)                         |

Root references: [README](../README.md) describes the product, [CONTEXT](../CONTEXT.md) defines terminology, [DESIGN](../DESIGN.md) specifies Skyline and [LESSONS](../LESSONS.md) records recurring failures. Historical screenshots are retained in the private external [acceptance evidence archive](operations/deployment.md#acceptance-evidence-retention), with hashes and their original release/run context.

Keep current operational state in the deployment guide and mark historical releases explicitly. Source/configuration remain authoritative for mechanically discoverable details. Record decisions and non-obvious constraints without maintaining competing copies of schemas or commands.

Follow the mandatory [evidence retention policy](operations/deployment.md#acceptance-evidence-retention): keep captured run output external and retain only archive metadata and observed results here.

Agent workflow references: [domain](agents/domain.md), [issue tracker](agents/issue-tracker.md) and [triage labels](agents/triage-labels.md). These describe repository collaboration; they do not add product integrations.
