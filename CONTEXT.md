# Product terminology

| Term              | Code / boundary            | Meaning                                                                                                 |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Browser owner     | Anonymous owner identity   | The browser-local identity used to authorize private projects; not a registered user account            |
| Project           | `Project` / `projects`     | An idea, its conversation, generated versions, current selection, and optional published link           |
| Idea              | `Project.idea`             | The original app request; not the full conversation                                                     |
| Agent             | SDK Agent / Runner         | Mike manages delegation; Emma, Bob, Alex and David execute scoped specialist work                       |
| Initial build     | Durable harness            | Manager decisions and specialist turns execute on GCP and checkpoint separately in D1                   |
| Follow-up         | Durable revision run       | Revises current HTML with the same browser-validation and review gate                                   |
| Message           | `ChatMessage` / `messages` | A persisted user, agent, or system entry in the project conversation                                    |
| Stream            | SSE event subscription     | Observation of D1 run events, replayable by sequence cursor; not execution ownership                    |
| Candidate         | Draft artifact             | Unaccepted HTML and checks; writing it does not create a successful version                             |
| Run               | D1 `runs`                  | Durable execution with status, ownership fence and persisted 15-minute deadline                         |
| Cursor            | D1 `run_events` sequence   | Last observed event sequence used for reconnect replay                                                  |
| Validation        | Native Playwright          | Isolated sandboxed Chromium checks against the current artifact hash                                    |
| Review            | David's role-scoped tool   | Explicit acceptance or repair findings independent of implementation                                    |
| Cancel            | Run/lease fence            | Writes stop immediately; executor aborts on heartbeat rejection; disconnect closes observation only     |
| Executor          | `apps/executor`            | Node 24 SDK/browser process on the approved GCP VM, polling the Cloudflare API                          |
| Lease             | D1 executor authority      | 60-second claim refreshed every 10 seconds; expired work can be reclaimed                               |
| Checkpoint        | D1 `run_checkpoints`       | Immutable named result reused after restart; not a provider token-stream snapshot                       |
| Version           | `AppVersion` / `versions`  | A complete generated HTML document with a project-local number and originating prompt                   |
| Current version   | `currentVersionId`         | The version selected as the project's current editable result                                           |
| Viewed version    | Browser workspace state    | The historical version currently inspected, which may differ from current or published                  |
| Restore           | Current pointer update     | Select a saved version as current; it does not republish the public link                                |
| Published version | `publishedVersionId`       | The saved version deliberately exposed through the project's public slug                                |
| Public link       | `/p/:slug`                 | Public access to published HTML only, not private chat or project management                            |
| Remix             | Project duplication        | A new owned project copied from the source conversation and versions                                    |
| Preview           | Sandboxed iframe           | Interactive generated HTML isolated from the application owner session                                  |
| Provider          | OpenAI-compatible endpoint | Real model execution through OpenAI Agents SDK 0.21; no mock mode                                       |
| Skyline           | Shared design system       | The inherited white canvas, sky wash, black actions, semantic statuses, Base UI controls, and Hugeicons |

`idle`, `generating`, and `error` are project execution states. “Published” describes a separate pointer, not an execution state. A project can retain a published or current version while a later generation attempt fails.

Run states are separate from project state: queued, running, completed, failed or cancelled. Failures distinguish timeout, provider, validation and internal errors. See [ADR-0012](docs/adr/0012-durable-agent-harness.md).
