# ADR-0012: Durable multi-agent execution

Status: accepted; the original Cloudflare Workflows/browser execution choice is superseded by the GCP executor decision below.

## Problem

The previous implementation ran a fixed sequence of persona completions inside one HTTP stream. A hard 120-second timer and client disconnection cancelled generation, both reported as `Generation stopped`. No tool loop, independent acceptance check, or resumable producer existed.

## Decision

Use OpenAI Agents SDK 0.21 (`@openai/agents-core`, `@openai/agents-openai`) for agents, model/tool loops and delegated specialists. Execute them in `apps/executor` on Node 24 with native Playwright under a non-root systemd service on a GCP VM. Cloudflare Pages, the Hono API Worker and D1 remain the presentation/control plane in the verified personal Cloudflare account. D1/Drizzle remains authoritative for ownership, runs, events, versions, leases and immutable named checkpoints.

The original Cloudflare Workflows plus Cloudflare browser binding implementation hit the Free plan's 10 ms Worker CPU limit during validator execution. The user approved moving compute to GCP rather than upgrading Cloudflare billing. This supersedes Workflow/browser bindings as the execution mechanism, not the SDK delegation or acceptance requirements.

Mike chooses the next specialist through a schema-validated SDK function tool. That decision is a durable step. Its selected specialist executes a separate Agent/Runner with its own context and role-scoped tools in another step. The next manager turn receives actual specialist results. The executor persists each completed step remotely before advancing and reuses saved results after restart. In-flight calls may replay after a crash; provider billing is not exactly-once.

The VM polls the API's `/internal/executor` control plane using bearer `EXECUTOR_TOKEN`; it exposes no public application port. D1 grants a 60-second lease, refreshed every 10 seconds. Lease tokens fence checkpoints, events and completion. Lost connectivity or service shutdown leaves work reclaimable after lease expiry; transient provider failures, including an HTTP response stream terminated after headers arrive, use bounded retries. Aborted signals are checked before retry classification, preserving explicit cancellation and deadline enforcement. The persisted 15-minute run deadline still applies across retries and reclaim.

- Emma: product scope and observable acceptance criteria.
- Bob: selects and initializes the demand-appropriate project template and defines implementation architecture.
- Alex: reads and modifies project files, builds the current source, writes acceptance checks, runs browser validation and repairs reported errors.
- David: independently reads source, validates the current build and accepts or rejects against the brief.
- Completion requires a build bound to the current source and artifact hashes, Alex's passing implementation validation and David's separate passing validation and explicit acceptance.

Specialists terminate at evidence-producing tools: Alex returns immediately from `validate_preview`, and David returns from `record_review`. A failed implementation report goes back to Mike for a targeted repair delegation; a repaired artifact requires a new independent review. This avoids spending additional model turns on narration after the required tools have completed. Tool termination does not bypass the final acceptance gate.

When independent QA corrects invalid check expectations and accepts a build that lacks Alex's passing implementation evidence, completion stays blocked. The manager and specialists receive the same explicit completion requirements. Alex validates the unchanged build against the corrected checks without rebuilding or rewriting valid source; David then independently validates and reviews again. Evidence-only validation is distinct from the bounded implementation/repair attempts and remains within the eight-delegation and task-deadline limits.

Targeted file repairs use ordered literal replacements that each match exactly once. The edit tool applies the complete set atomically, rejects stale or ambiguous targets, preserves acceptance checks, and invalidates the build, validation and review. Small fixes avoid regenerating unchanged files while requiring fresh evidence. Versioned `project-v1-*` checkpoint names keep obsolete HTML-only checkpoints out of the source workflow.

Native Playwright launches sandboxed Chromium with a credential-stripped environment. Each check has a fresh context, opaque iframe, restrictive inherited CSP, blocked HTTP/WebSocket requests, blocked service workers and disabled downloads. Bounded declarative checks support click/fill/press/reload, text containment, exact value/count/attribute assertions, and a fixed horizontal-overflow assertion at a specified viewport. Assertions poll concurrently within a shared five-second deadline, so an incorrect expectation cannot consume every later assertion's observation time. Polling and the final verdict use the same match result. Boolean HTML attributes retain literal string semantics; test enabled/disabled state through selector counts rather than expecting a missing attribute to equal "false". Arbitrary model JavaScript is never evaluated in the privileged executor. Alex and David can replace acceptance checks independently of HTML; doing so invalidates previous validation and review. This avoids requiring implementation changes merely to improve test coverage. Failed validation returns evidence to the agent, not a successful saved version.

The browser starts a run and observes its persisted event log. Disconnect closes only the subscription. Reconnection replays by sequence. User cancellation fences writes; the executor aborts when its heartbeat loses authority. Timeout, provider failure, validation failure and cancellation remain distinct. A failed run keeps the prior complete version.

## Alternatives researched

| Candidate                              | Strength                                                                            | Reason not selected                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| AI SDK ToolLoopAgent                   | Explicit compatible Chat Completions adapter, real child tools, Cloudflare examples | Viable alternative, but no built-in durable checkpoints; OpenAI Agents passed the actual provider delegation proof first         |
| LangGraph JS                           | Graph/checkpoint persistence and resumable control flow                             | Extra integration is unnecessary for the proven SDK and explicit D1 checkpoint protocol                                          |
| Cloudflare Workflows / browser binding | Native durable steps and managed browser                                            | Superseded after the Free Worker CPU limit killed validation; GCP execution was explicitly approved instead of a billing upgrade |
| Cloudflare Agents fibers               | Durable acceptance and recovery hooks                                               | Does not remove the observed Worker CPU constraint or automatically replay an interrupted tool loop                              |

## Evidence and limits

The configured `gpt-6.1-sol` endpoint returned a real function call; an earlier Node SDK manager/child nonce proof established SDK/provider delegation, not deployed durability. The integration owner subsequently reported 18 server tests and 3 executor tests passing. Online end-to-end acceptance of the GCP executor is ongoing and is not claimed complete here.

The GCP trial was browser-verified at $296.45 remaining and 62 days remaining at approval time. The user approved `formlane-agent`, zone `us-central1-c`, project `roibest-internal-apps`, account `maqiqian@roibest.com`: `e2-standard-2`, 2 vCPU, 8 GB RAM, 30 GB disk. The displayed estimate was $51.92/month plus IPv4, egress and other applicable charges; this is a dated estimate, not a spending cap. No billing upgrade was authorized. Deployment identity and secret handling are recorded in [deployment](../operations/deployment.md).

## Primary references

- [OpenAI agent orchestration](https://openai.github.io/openai-agents-js/guides/multi-agent/)
- [OpenAI compatible Chat Completions provider](https://openai.github.io/openai-agents-js/guides/models/)
- [Runner tool loops and execution state](https://openai.github.io/openai-agents-js/guides/running-agents/)
- [AI SDK agent primitives](https://ai-sdk.dev/docs/agents/overview)
- [LangGraph overview](https://docs.langchain.com/oss/javascript/langgraph/overview)
- [Playwright browser contexts](https://playwright.dev/docs/browser-contexts)
- [Playwright network controls](https://playwright.dev/docs/network)
- [Compute Engine VM instances](https://cloud.google.com/compute/docs/instances)
