# Generation workflow retrospective (2026-11-13)

Outcome: [ADR-0015](../../adr/0015-flow-first-delivery.md). This page records why the hierarchical Crew was replaced and which external practices informed the replacement.

## What the business loop needs

idea → visible team work → compiled preview → saved version → optional publication; follow-ups revise the saved source. Users judge it by four properties, while invariants 2–7 are non-negotiable guarantees:

| Need                      | Measure                                                 |
| ------------------------- | ------------------------------------------------------- |
| See real progress quickly | Time to first visible source and first compiled preview |
| Get a working app         | Saved-version rate per run                              |
| Finish in reasonable time | Wall time and model calls per initial build             |
| Iterate cheaply           | Wall time for a small follow-up                         |

## What went wrong with the hierarchical Crew

Evidence comes from LESSONS entries and the deployment ledger, not from new runs.

1. **Policy lived in a prompt.** Mike's contract encoded fixed rules: Emma and Bob once, Alex at most twice, Alex validation before David, recovery dances after check corrections. Each decision cost a manager model turn, and runs still violated it: repeated completion attempts without evidence, QA exhausting turns, the replayed delegation budget blocking acceptance.
2. **Tests followed code.** Alex wrote checks for his own source; David then disputed coverage or wrong expectations. Several lessons (unsupported keys, computed-style assertions, select filled as text) are check-authoring failures, not app defects.
3. **Evidence invalidation forced extra cycles.** A David check correction cleared Alex's validation stamp; Alex's re-validation then cleared David's review, requiring another David turn.
4. **Follow-ups had no regression baseline.** Versions stored source only, so every follow-up rebuilt acceptance from scratch and once reverted an accepted feature (LESSONS 2026-11-12).
5. **Fixed deadlines masked orchestration cost.** Healthy runs with 63 committed checkpoints hit the 15-minute limit. The deadline was removed; the underlying number of serial model turns remained.

Kept unchanged because it works: PostgreSQL leases, DBOS per-operation replay, fenced cancellation, sandboxed Playwright and compiler, exact-once literal edits, source/artifact/check-bound acceptance, and the rule that partial output is never a saved success.

## What the references teach

| Source                                                                                                                                                                                                | Practice                                                                                                                                       | Applied as                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [v0 coding agent](https://vercel.com/blog/how-we-made-v0-an-effective-coding-agent), [v0 composite model](https://vercel.com/blog/v0-composite-model-family)                                          | One agent rather than personas; deterministic and small-model autofixers; a separate quick-edit path; success measured as working-preview rate | Single writer; deterministic verification; quick-edit route                                      |
| [crewAI production architecture](https://docs.crewai.com/en/concepts/production-architecture), [Flows](https://docs.crewai.com/en/concepts/flows), [Tasks](https://docs.crewai.com/en/concepts/tasks) | Start with a Flow; typed state; focused agents/crews per step; structured outputs between steps; guardrails return a reason and retry          | `DeliveryFlow` with router/listeners; `submit_plan` structured handoff; build/verify/repair loop |
| [Anthropic: building effective agents](https://www.anthropic.com/engineering/building-effective-agents)                                                                                               | Prefer composable workflows; evaluator-optimizer where criteria are clear                                                                      | Bounded verify→repair and review→repair loops                                                    |
| [Anthropic: multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system)                                                                                                  | Multi-agent pays off for parallel breadth at ~15× chat tokens; coding is rarely parallel                                                       | No parallel writers; review is the one independent context                                       |
| [Cognition: don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents)                                                                                                             | Parallel actors make conflicting implicit decisions                                                                                            | Selector contract fixed in the plan before code                                                  |
| [Anthropic: long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)                                                                                | JSON feature list with pass flags; browser testing as a user would                                                                             | Criteria plus checks persisted per version as the regression suite                               |
| [OpenAI practical guide](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)                                                                               | Maximize a single agent before adding a manager                                                                                                | Mike reduced to a follow-up router                                                               |

## Decisions confirmed by the user

1. Keep implementation validation and independent review before every save.
2. Build immediately after planning; no confirmation pause.
3. Personas narrate real stages from fewer model calls (Emma and Bob share one plan call).
4. Templates provide a base stylesheet the model reuses.

## Open measurements

Before/after numbers require real-provider runs on the deployed worker. Record per run: model calls, time to first source file, wall time, repair rounds, saved-version outcome. Use a fixed set of about twenty prompts (form, list/filter, SVG map, game, dashboard, Chinese copy, follow-up edits) so prompt changes are compared on the same inputs rather than single runs.
