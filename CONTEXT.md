# Product terminology

| Term              | Boundary                              | Meaning                                                                                                           |
| ----------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Browser owner     | Anonymous ownership capability        | Existing browser-local `atoms_uid`, sent as `x-owner-id`; not a registered account                                |
| Project           | `projects`                            | Idea, conversation, source versions, current selection and optional publication                                   |
| Idea              | `Project.idea`                        | Original request; not a requirement to replay over later accepted edits                                           |
| Agent             | Native CrewAI Agent / Crew            | A focused analyst, implementation owner or independent reviewer inside an explicit delivery stage                 |
| Initial build     | Durable Python worker                 | Creates a source project from the request and checkpoints completed agent work in PostgreSQL                      |
| Follow-up         | Durable revision run                  | Revises the current immutable source baseline with fresh build, browser and review evidence                       |
| Message           | `messages`                            | Persisted user, agent or system conversation entry                                                                |
| Run               | `runs`                                | One durable user request retaining its identity and completed work across execution attempts                      |
| Attempt           | Run lifecycle                         | An execution interval without a fixed whole-run deadline; explicit resume advances it, reconnect/reclaim does not |
| Resume            | Authorized existing-run continuation  | Continue eligible failed/cancelled work from committed results, without another user message                      |
| Stream            | Owned SSE subscription                | Replayable observation of persisted events; never execution ownership                                             |
| Cursor            | `run_events` sequence                 | Last observed sequence for reconnect replay                                                                       |
| Candidate         | Private retained checkpoint           | Unaccepted source and optional compiled preview; inspectable without changing accepted versions or publication    |
| Validation        | Native Playwright                     | Browser evidence bound to source, artifact, frozen contract and named check set                                   |
| Review            | Independent execution scope           | Baseline/current inspection, independent browser validation and requirement-linked acceptance or repair findings  |
| Cancel            | Run/lease fence                       | Invalidates producer writes; closing a tab only stops observation                                                 |
| Worker            | `apps/backend/src/formlane/worker.py` | Python process on the approved GCP VM that claims PostgreSQL work and runs CrewAI                                 |
| Lease             | PostgreSQL producer authority         | 60-second claim refreshed every 10 seconds; expired work is reclaimable                                           |
| Checkpoint        | DBOS history / application journal    | Committed model/tool result or retained candidate; not an interrupted token-stream snapshot                       |
| Version           | `versions`                            | Immutable source plus compiled preview, project-local number and originating prompt                               |
| Current version   | `currentVersionId`                    | Saved version used as the editable baseline                                                                       |
| Viewed version    | Browser workspace state               | Historical version being inspected; may differ from current and published                                         |
| Restore           | Current pointer update                | Selects a saved version without publishing it or deleting later history                                           |
| Undo              | Recorded ancestry                     | Selects the current version's generation parent, not the preceding numbered version                               |
| Published version | `publishedVersionId`                  | Saved version explicitly exposed through the project's public slug                                                |
| Public link       | Frontend `/p/:slug` viewer            | Anonymous isolated published application, keeping the custom domain and excluding private management              |
| Remix             | Independent project copy              | New owned identities/history with copied ancestry and selected source                                             |
| Preview           | Opaque sandboxed iframe               | Generated HTML isolated from owner credentials and browser storage                                                |
| Template          | `ProjectSource.template`              | Demand-selected Vanilla or React + TypeScript project with fixed dependencies                                     |
| Compiler          | `apps/compiler`                       | Isolated Node subprocess that compiles virtual source; owns no business routes, database or agents                |
| Provider          | Compatible Chat Completions endpoint  | Real configured model used by native CrewAI; secrets remain server-side                                           |
| Skyline           | Shared design system                  | White canvas, sky wash, black actions, semantic statuses, Base UI and Hugeicons                                   |

Project execution states are `idle`, `generating` and `error`. Publication is a separate pointer. Run states are queued, running, completed, failed or cancelled; timeout, provider, validation, step-limit, capability and internal failures remain distinct. A later failure preserves current and published versions. The current runtime supports frontend rendering and page-memory interactions; persistent shared business data requires unavailable runtime capabilities.

The architecture is Python/FastAPI/CrewAI/DBOS/PostgreSQL with static Pages. [Deployment](docs/operations/deployment.md) owns rollout status, migration evidence and recovery boundaries.
