# Architecture decisions

These decisions adapt the reference engineering baseline to Atoms. Numbers retain useful inherited identifiers; gaps are intentional because unrelated business decisions were removed.

| ADR                                         | Decision                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| [0001](0001-tech-stack.md)                  | pnpm/Turbo monorepo and shared package boundaries                                       |
| [0002](0002-shadcn-only-ui.md)              | Shared Base UI/shadcn components and complete Skyline design                            |
| [0003](0003-targeted-tests-only-locally.md) | Focused local verification and one integration owner                                    |
| [0004](0004-deploy-envs-and-config.md)      | Explicit verified account and fail-closed deployment configuration                      |
| [0009](0009-orpc-contract-first.md)         | Contract-first oRPC for CRUD, preserved SSE/document endpoints                          |
| [0010](0010-server-on-workers.md)           | Historical Worker/Drizzle D1 decision; superseded by 0013, 0014 and 0015                |
| [0011](0011-i18n-catalog.md)                | One English/Chinese catalog                                                             |
| [0012](0012-durable-agent-harness.md)       | Historical Node SDK/D1 harness; superseded by 0013, 0014 and 0015; acceptance retained  |
| [0013](0013-python-postgres-services.md)    | Python API/CrewAI and PostgreSQL on GCP; separate static Pages cutover                  |
| [0014](0014-dbos-node-recovery.md)          | DBOS/PostgreSQL model and tool recovery with same-run attempts and fenced execution     |
| [0015](0015-flow-first-delivery.md)         | Code-orchestrated CrewAI Flow: plan → build → deterministic verify → independent review |

Status in an ADR records a design decision, not proof of a successful build or release. New decisions use the next available number and state context, decision, consequences, and any superseded rule. Update stale decisions explicitly rather than copying a conflicting rule into another guide.
