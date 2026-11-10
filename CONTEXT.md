# Product terminology

| Term              | Code / boundary            | Meaning                                                                                                             |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Browser owner     | Anonymous owner identity   | The browser-local identity used to authorize private projects; not a registered user account                        |
| Project           | `Project` / `projects`     | An idea, its conversation, generated versions, current selection, and optional published link                       |
| Idea              | `Project.idea`             | The original app request; not the full conversation                                                                 |
| Agent             | `AgentId`                  | Mike, Emma, Bob, Alex, or David, a persona in the orchestrated build pipeline                                       |
| Initial build     | Generation pipeline        | Mike plans, Emma specifies, Bob designs, Alex writes HTML, David suggests measurements                              |
| Follow-up         | Chat generation            | Mike interprets a change and Alex rewrites the current HTML; it is not an independent project                       |
| Message           | `ChatMessage` / `messages` | A persisted user, agent, or system entry in the project conversation                                                |
| Stream            | SSE                        | Incremental status, conversation, and code events over a request; not durable background execution                  |
| Partial code      | Alex stream parser         | In-progress HTML shown while generation runs; not yet a complete saved version                                      |
| Version           | `AppVersion` / `versions`  | A complete generated HTML document with a project-local number and originating prompt                               |
| Current version   | `currentVersionId`         | The version selected as the project's current editable result                                                       |
| Viewed version    | Browser workspace state    | The historical version currently inspected, which may differ from current or published                              |
| Restore           | Current pointer update     | Select a saved version as current; it does not republish the public link                                            |
| Published version | `publishedVersionId`       | The saved version deliberately exposed through the project's public slug                                            |
| Public link       | `/p/:slug`                 | Public access to published HTML only, not private chat or project management                                        |
| Remix             | Project duplication        | A new owned project copied from the source conversation and versions                                                |
| Preview           | Sandboxed iframe           | Interactive generated HTML isolated from the application owner session                                              |
| Real mode         | OpenAI-compatible provider | Streamed chat completions using the configured provider and model                                                   |
| Mock mode         | `MOCK_LLM`                 | Explicit local deterministic generation using the same product stream/persistence path; not a general-purpose model |
| Skyline           | Shared design system       | The inherited white canvas, sky wash, black actions, semantic statuses, Base UI controls, and Hugeicons             |

`idle`, `generating`, and `error` are project execution states. “Published” describes a separate pointer, not an execution state. A project can retain a published or current version while a later generation attempt fails.
