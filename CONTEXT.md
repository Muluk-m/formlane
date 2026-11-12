# Product terminology

| Term              | Boundary                              | Meaning                                                                                              |
| ----------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Browser owner     | Anonymous ownership capability        | Existing browser-local `atoms_uid`, sent as `x-owner-id`; not a registered account                   |
| Project           | `projects`                            | Idea, conversation, source versions, current selection and optional publication                      |
| Idea              | `Project.idea`                        | Original request; not a requirement to replay over later accepted edits                              |
| Agent             | Native CrewAI Agent / Crew            | Mike delegates to Emma, Bob, Alex and David through role-scoped tools                                |
| Initial build     | Durable Python worker                 | Creates a source project from the request and checkpoints completed agent work in PostgreSQL         |
| Follow-up         | Durable revision run                  | Revises the current immutable source baseline with fresh build, browser and review evidence          |
| Message           | `messages`                            | Persisted user, agent or system conversation entry                                                   |
| Run               | `runs`                                | One durable user request retaining its identity and completed work across execution attempts         |
| Attempt           | Run lifecycle                         | One bounded execution interval; explicit resume advances it, while reconnect/reclaim does not        |
| Resume            | Authorized existing-run continuation  | Continue eligible failed/cancelled work from committed results, without another user message         |
| Stream            | Owned SSE subscription                | Replayable observation of persisted events; never execution ownership                                |
| Cursor            | `run_events` sequence                 | Last observed sequence for reconnect replay                                                          |
| Candidate         | Worker workspace                      | Unaccepted source and checks; writing or compiling it does not save a successful version             |
| Validation        | Native Playwright                     | Sandboxed browser checks bound to current source, artifact and check-set evidence                    |
| Review            | David's scoped tools                  | Independent validation and explicit acceptance or repair findings                                    |
| Cancel            | Run/lease fence                       | Invalidates producer writes; closing a tab only stops observation                                    |
| Worker            | `apps/backend/src/formlane/worker.py` | Python process on the approved GCP VM that claims PostgreSQL work and runs CrewAI                    |
| Lease             | PostgreSQL producer authority         | 60-second claim refreshed every 10 seconds; expired work is reclaimable                              |
| Checkpoint        | DBOS history / retained legacy rows   | Committed model/tool result reused during replay; not an interrupted token-stream snapshot           |
| Version           | `versions`                            | Immutable source plus compiled preview, project-local number and originating prompt                  |
| Current version   | `currentVersionId`                    | Saved version used as the editable baseline                                                          |
| Viewed version    | Browser workspace state               | Historical version being inspected; may differ from current and published                            |
| Restore           | Current pointer update                | Selects a saved version without publishing it or deleting later history                              |
| Undo              | Recorded ancestry                     | Selects the current version's generation parent, not the preceding numbered version                  |
| Published version | `publishedVersionId`                  | Saved version explicitly exposed through the project's public slug                                   |
| Public link       | Frontend `/p/:slug` viewer            | Anonymous isolated published application, keeping the custom domain and excluding private management |
| Remix             | Independent project copy              | New owned identities/history with copied ancestry and selected source                                |
| Preview           | Opaque sandboxed iframe               | Generated HTML isolated from owner credentials and browser storage                                   |
| Template          | `ProjectSource.template`              | Demand-selected Vanilla or React + TypeScript project with fixed dependencies                        |
| Compiler          | `apps/compiler`                       | Isolated Node subprocess that compiles virtual source; owns no business routes, database or agents   |
| Provider          | Compatible Chat Completions endpoint  | Real configured model used by native CrewAI; secrets remain server-side                              |
| Skyline           | Shared design system                  | White canvas, sky wash, black actions, semantic statuses, Base UI and Hugeicons                      |

Project execution states are `idle`, `generating` and `error`. Publication is a separate pointer. Run states are queued, running, completed, failed or cancelled; timeout, provider, validation, step-limit and internal failures remain distinct. A later failure preserves current and published versions.

The architecture is Python/FastAPI/CrewAI/DBOS/PostgreSQL with static Pages. [Deployment](docs/operations/deployment.md) owns rollout status, migration evidence and recovery boundaries.
