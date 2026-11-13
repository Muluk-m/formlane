# Formlane

A browser-based AI product team: describe an app, watch specialists build source files, revise the result, inspect versions, and publish a selected preview. Read [CONTEXT.md](CONTEXT.md) for product terminology.

## Invariants

1. Preserve idea → streamed team conversation → compiled preview → immutable source version → optional publication. Follow-ups start from the current source and require fresh evidence for that exact candidate.
2. Failed or cancelled runs preserve the last complete version. Partial drafts are never saved successes.
3. Authorize every private project, message, version and download against the anonymous browser owner on the backend.
4. Public `/p/:slug` exposes only the explicitly published version. Restore and Undo change current selection, not publication; unpublish revokes public access.
5. Generation uses the real configured provider. Missing credentials fail visibly; there is no mock generation or silent fallback.
6. Generated HTML is untrusted. Preserve the opaque iframe, sandboxed Chromium and credential-stripped compiler/browser processes.
7. Disconnect closes observation only. Cancellation fences writes. Completion requires current-source build evidence, passing implementation and independent browser validation, and David's acceptance. Runs have no fixed wall-clock deadline; retain per-operation timeouts and lease fencing.
8. PostgreSQL owns all six business tables. Apply Alembic explicitly; requests and startup never create schema. Pages serves static React assets only; Node is restricted to the trusted compiler.

## Every task

- Work in the assigned Formlane checkout. The reference `/Users/qiqian/Projects/Qlj/adcounter` is read-only; inherit its engineering and Skyline baseline, not its business domain.
- Use pnpm/Turbo for JavaScript workspaces and uv for the Python backend. Manifests, lockfiles and installed declarations define dependency APIs and commands.
- Use `@atoms-demo/ui` (shadcn base-nova / Base UI), Hugeicons at 1.5 stroke width and [DESIGN.md](DESIGN.md). Preserve the white/sky/black appearance and component variants.
- All visible English/Chinese copy belongs to `packages/i18n`; documentation and descriptions are English.
- API changes update `@atoms-demo/contracts`, Python request/response models and web consumers together. Shared packages never import applications.
- Read [LESSONS.md](LESSONS.md) before implementation. Preserve unrelated work. One integration owner coordinates authorized checks and coherent English Conventional Commits after shared edits land; delegated editors do not independently install, verify, commit or deploy.
- Remote mutations follow the existing authorization and exact cloud identity boundary in [deployment](docs/operations/deployment.md). A staged HTTPS endpoint is not evidence of production cutover.
- Keep acceptance screenshots, videos, traces and run logs in a private archive outside every source checkout. Record its location, build/run IDs, SHA-256 manifest and observed results in documentation; legitimate product assets and deterministic test fixtures remain source. Follow [evidence retention](docs/operations/deployment.md#acceptance-evidence-retention).

## Read when

| Task                                                            | Read first                                                                                                                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change an application/package                                   | Nearest guidance: [web](apps/web/AGENTS.md), [backend](apps/backend/AGENTS.md), [core](packages/atoms-core/AGENTS.md), [UI](packages/ui/AGENTS.md), [i18n](packages/i18n/AGENTS.md) |
| Develop or choose checks                                        | [Development](docs/operations/development.md), [testing](docs/internals/testing.md)                                                                                                 |
| Deploy, import data or recover a release                        | [Deployment](docs/operations/deployment.md)                                                                                                                                         |
| Diagnose streaming, data, preview or runtime failures           | [Debugging](docs/operations/debugging.md)                                                                                                                                           |
| Change module boundaries                                        | [Architecture](docs/internals/architecture.md), [standards](docs/internals/code-standards.md)                                                                                       |
| Change persistence, publication, runner, replay or cancellation | [Data model](docs/internals/data-model.md), [ADRs](docs/adr/README.md)                                                                                                              |
| Find deeper context                                             | [Documentation index](docs/README.md)                                                                                                                                               |

## Delivery

Describe the implemented behavior, checks actually exercised and remaining unknowns. UI evidence must identify the build shown. Keep decisions in ADRs, recurring failures in LESSONS, and current operational state in the deployment guide.
