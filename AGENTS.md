# Atoms Demo

A browser-based AI product team: describe an app, watch specialist agents select a template and build its source files, revise it, inspect versions, and publish a selected preview. Start with [CONTEXT.md](CONTEXT.md) for product terminology. This file contains only rules needed on every task; follow the relevant pointers before changing a subsystem.

## Invariants

1. Preserve the original product loop: idea → streamed team conversation → compiled preview → saved source version → optional publication. Follow-up edits reuse the current source tree; acceptance requires a build and browser evidence for that exact source.
2. A failed or cancelled generation must not replace the last complete version. Partial stream content is not a saved success.
3. Check anonymous ownership on the server before private project, message, version, or download access. A hidden button is not access control.
4. Public `/p/:slug` serves only the explicitly published version. Restoring a version does not publish it; unpublishing revokes the public route.
5. Generation uses the real provider only. A missing provider key is an error; mock generation and silent fallback are unsupported.
6. Generated HTML is untrusted. Preserve the preview sandbox and keep owner credentials out of generated content and public responses.
7. Preserve durable run ownership: disconnect closes observation only; explicit cancellation fences writes. Completion requires current-artifact browser validation and independent review, within the persisted 15-minute deadline.

## Every task

- Work in `/Users/qiqian/Projects/Self/atoms-demo`. The reference `/Users/qiqian/Projects/Qlj/adcounter` is read-only; inherit its engineering and Skyline design baseline, not its business domain.
- Use pnpm workspaces and Turbo. Package manifests, the lockfile, and installed declarations are authoritative for commands and dependency APIs.
- Use `@atoms-demo/ui` (shadcn base-nova / Base UI), Hugeicons at 1.5 stroke width, and [DESIGN.md](DESIGN.md). Keep the white/sky/black appearance and existing component variants.
- All visible English/Chinese copy belongs to `packages/i18n`; documentation and descriptions are English. Do not create a second catalog.
- API changes start in `@atoms-demo/contracts`; runtime-independent core logic lives in `@atoms-demo/core`. Packages never import application code.
- Cloudflare deployment requires authorization and the verified personal account **Maqiqian0316@gmail.com's Account** (`252fba810f75c0370e5aa7200abc8f80`). GCP executor deployment has a separate approved identity and resource boundary; read [deployment](docs/operations/deployment.md) before either remote mutation.
- Coordinate expensive checks once after shared edits land. Run only relevant checks locally; do not overlap installs/builds/full suites across agents. Report only checks actually exercised.
- Read [LESSONS.md](LESSONS.md) before implementation. Preserve unrelated work. The integration owner creates coherent module commits; delegated editors do not independently commit shared changes. Pushes and deployments require separate authorization.

## Read when

| Task                                                                      | Read first                                                                                                                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change an application/package                                             | Its nearest AGENTS.md: [web](apps/web/AGENTS.md), [server](apps/server/AGENTS.md), [core](packages/atoms-core/AGENTS.md), [UI](packages/ui/AGENTS.md), [i18n](packages/i18n/AGENTS.md) |
| Start development or choose checks                                        | [Development](docs/operations/development.md) and [testing](docs/internals/testing.md)                                                                                                 |
| Deploy, migrate a remote database, or verify a release                    | [Deployment](docs/operations/deployment.md)                                                                                                                                            |
| Diagnose streaming, data, preview, or runtime problems                    | [Debugging](docs/operations/debugging.md)                                                                                                                                              |
| Change module boundaries or review a complete feature                     | [Architecture](docs/internals/architecture.md) and [standards](docs/internals/code-standards.md)                                                                                       |
| Change persistence or publication                                         | [Data model](docs/internals/data-model.md) and [ADRs](docs/adr/README.md)                                                                                                              |
| Change agent tools, validation, durable execution, replay or cancellation | [ADR-0012](docs/adr/0012-durable-agent-harness.md) and [data model](docs/internals/data-model.md)                                                                                      |
| Find deeper context                                                       | [Documentation index](docs/README.md)                                                                                                                                                  |

## Delivery

Commit each completed, independently describable module with a brief English Conventional Commit message rather than accumulating unrelated work in one commit. The integration owner handles commits after shared edits and agreed checks settle. Describe the problem, the implemented fix, exercised checks, and remaining unknowns. UI changes need screenshots when browser verification is requested. Update a decision in its ADR and a recurring failure in LESSONS; avoid copying facts already expressed by source code.
