# ADR-0015: Code-orchestrated delivery Flow

Status: accepted. Supersedes the hierarchical Crew orchestration in [ADR-0013](0013-python-postgres-services.md) and the manager-delegation part of [ADR-0012](0012-durable-agent-harness.md). DBOS recovery, leases, cancellation and the acceptance gate in [ADR-0014](0014-dbos-node-recovery.md) are unchanged.

## Context

The hierarchical Crew let Mike choose every next specialist. Fixed rules ("delegate Emma and Bob once", "Alex at most twice", "Alex validation before David review") lived in a long manager prompt, cost a model round-trip per decision and were repeatedly violated in real runs (see LESSONS 2026-11-12/13: completion attempted without evidence, QA exhausting turns, replay consuming the delegation budget). Tests were written after code by the implementer, so review spent turns disputing coverage. Follow-ups had no saved regression checks. Users judge the loop by time to first visible source, saved-version rate, wall time and follow-up cost. The research notes in [docs/research](../research/) and the sources below compare v0, crewAI, OpenAI and Anthropic guidance; all recommend code-owned workflows with structured handoffs, one writer per artifact and evaluator-optimizer loops over clear criteria.

## Decision

Use a native CrewAI `Flow` (`DeliveryFlow` in `agents.py`) as the orchestrator, following crewAI's Flow-first production guidance. Each stage is one focused CrewAI `Agent` with role-scoped tools and a terminal tool; the Flow decides order and bounds.

1. **Route (Mike).** Initial builds always plan. Follow-ups make one small `choose_route` call: `quick_edit` or `plan`. Quick edit requires saved acceptance checks; otherwise the route falls back to plan.
2. **Plan (Emma and Bob).** One `submit_plan` call returns brief, A1–A8 criteria, assumptions, gaps, template, architecture and 2–12 acceptance checks. It initializes new projects. Checks are written before code and define the selector contract. The UI shows Emma's brief and Bob's architecture from this single structured result.
3. **Build (Alex).** Alex is the only writer of source and works in one ReAct loop with environment feedback: read/search, write/edit, `build_project`, `inspect_preview` (accessibility tree, console, page errors, document width, optionally after actions, viewport, clock or seed), `validate_preview`, fix, repeat. `submit_candidate` requires passing validation of the current build, or every failing check named in `check_defects` for the reviewer to judge. On the plan path he cannot change checks; a quick edit may update the saved set, which David then reviews independently.
4. **Verify (gate).** If Alex's implementation evidence matches the current build, no browser work repeats. Otherwise the harness builds and validates without a model call. A fixed smoke check (375px render, no runtime error, no horizontal overflow) is prepended to every check set. Undisputed failures go to a targeted Alex repair, at most two rounds; disputed or remaining failures continue to review because they may be check defects.
5. **Review (David).** Fresh context: reads changed and needed files once, inspects the running app, judges checks against the original request rather than only the plan, may correct the check set once, runs his own validation and records the verdict. If his corrected checks leave implementation evidence missing, the harness re-runs it deterministically. A rejected verdict triggers one Alex repair and another review; after that the run fails with `validation`.
6. **Deliver.** Completion still requires current build, Alex validation, David validation and David acceptance, bound to the exact source, artifact and check set. The saved version stores the accepted check set (`versions.acceptance_checks`) as the next follow-up's regression baseline.

Evidence semantics change in one respect: independent validation is recorded separately (`independentValidation`, bound to artifact and check-set hashes). Implementation re-validation on unchanged source therefore no longer erases David's verdict. This removes the Alex→David→Alex→David evidence dance without weakening any requirement.

Templates now ship a small base stylesheet (layout, card, button, field, badge, screen-reader utilities). Plans and builds reuse it, so generated CSS stays proportional to scope. TypeScript and Python template snapshots and hash fixtures change together.

The integration keeps this native Flow and its three acceptance gates as the only execution path. The alternative `flow-v2` implementation remains a research comparison, not a second production worker. Its [v0 research](../research/2026-11-13-v0-workflow.md) and [CrewAI research](../research/2026-11-13-crewai-workflow.md) are retained as supporting sources.

Private candidates are checkpointed after committed source/build operations, outside nested DBOS steps. Failed or cancelled work can be inspected without becoming an accepted version. The owner API exposes only the latest eligible run's candidate while its baseline still matches the current version; completion, a replacement request or a changed baseline hides it. Downloads, history and publication continue to use accepted versions only.

## Consequences

- Happy path model calls drop from a manager turn per delegation plus four specialists to: route (follow-ups only), plan, build, review. Verification and its repair routing cost no model calls.
- Stage keys (`flow-v1/plan-0`, `flow-v1/build`, `flow-v1/verify-0`, `flow-v1/repair-0`, `flow-v1/review-0`, …) are deterministic, so DBOS replay reuses committed model and tool operations exactly as before.
- New runs use execution version `flow-v1`. Runs created as `crew-v1` or `dbos-v1` fail closed as incompatible on this worker and are not resumable; drain them before activation or keep the previous worker release until they finish.
- Migration `0004_version_acceptance_checks` must be applied before the API or worker starts; readiness checks the new revision. Imported and earlier versions have null checks and route follow-ups to plan.
- The Flow runs with `suppress_flow_events`, tracing disabled and auto-memory skipped. Stage failures are captured inside Flow methods and re-raised unchanged after kickoff so cancellation and failure codes do not depend on asyncio thread propagation.
- Per-stage model selection, screenshots returned to the model and streaming the plan into the UI are deliberate follow-ups, not part of this decision.

## Deterministic browser environment

Staging run `05fa1643-67a3-43fc-a2ff-b9509ed181e1` saved a tool library that hardcoded "today" as 2026-03-18 because checks could not control time, so the plan pinned dates and the build matched them. Production style follow-ups on 2048 (`1e28f623-3fb7-4b5d-a682-bb4745b70c76`, `9edbdb6b-7ff3-47e9-9ff0-dd7f99524b2e`, `a2717c46-3673-475c-8783-ebb7723c891d`) spent 13 validations and 10 check rewrites on expectations about randomly spawned tiles and never saved. The browser environment is therefore deterministic and controllable:

- Each check may set `clock {now, timezone}`. Checks asserting calendar dates must set it, and the set must contain two different `clock.now` values, so a hardcoded date cannot pass both.
- `Math.random` and `crypto.getRandomValues` are seeded per check (`seed`, default 1) by an init script inside the sandboxed iframe. The same check observes the same random state every run; `inspect_preview` with that seed shows it.
- The first `srcdoc` document in the isolated iframe ran before Playwright's clock, timezone and init-script overrides attached (observed on the VM: at-load values were real time, UTC and unseeded). A warm-up navigation precedes every candidate load so overrides apply from the app's first script.

## Reasoning effort

The provider defaults to deep reasoning. Staging plan call `flow-v1/plan-0/llm-1` took 306 s for a 19.6 KB result. Probes on `grok-4.7` accepted `low`, `medium` and `high` with and without tools and rejected `none`. Stages set effort explicitly: router and planner `low`; builder, quick edit, repair and reviewer `medium`.

## Alternatives

| Option                                              | Reason not selected                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the hierarchical Crew and refine prompts       | Real-provider runs kept violating prompt-encoded routing; crewAI positions Flows as the production control layer                        |
| Plain Python state machine without `Flow`           | Equivalent control, but the user asked to follow crewAI's official practice; `Flow` adds a declared, plottable graph at negligible cost |
| Parallel specialists writing source                 | Conflicting implicit decisions (Cognition); one writer remains                                                                          |
| Save after deterministic verification, review later | Rejected by the user: every saved version keeps independent review                                                                      |

## Sources

[crewAI production architecture](https://docs.crewai.com/en/concepts/production-architecture), [crewAI Flows](https://docs.crewai.com/en/concepts/flows), [crewAI task guardrails](https://docs.crewai.com/en/concepts/tasks), [v0 coding agent](https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent), [Anthropic: building effective agents](https://www.anthropic.com/engineering/building-effective-agents), [Cognition: don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents), [OpenAI practical guide](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf).
