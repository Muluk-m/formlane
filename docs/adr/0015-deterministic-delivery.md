# Deterministic delivery with artifact-bound acceptance

Status: accepted design; rollout and real-provider evidence belong to [deployment](../operations/deployment.md). This supersedes the managerial orchestration and actor-specific validation stamps in ADR-0012/0013 while retaining ADR-0014's DBOS authority and lease fences.

A production tool-library run compiled twice and passed browser checks three times but saved no version. An accepted review lacked a builder-specific stamp; subsequent product reanalysis added a disclosure requirement and exhausted delegation capacity. More managerial iterations would not make delivery converge.

Use explicit Python stages inside DBOS: freeze request/baseline/capabilities once, implement with a focused native CrewAI worker, retain the candidate, compile, validate, independently review, and atomically accept. Models own coding and judgment; application code owns required transitions and committing a successful result. Repairs receive concrete findings and stop on repeated unchanged work or exhausted repair allowance. No fixed whole-run deadline is introduced.

Acceptance binds source, artifact, frozen contract and check identities. Independent review uses a separate execution scope and inspects baseline/current source. A worker's final answer never substitutes for gates. Retained candidates are private unaccepted artifacts and do not alter version counts, current selection or publication. Unsupported runtime capabilities remain a visible failure, even when useful frontend work can be retained.

DBOS remains the sole recovery authority. Stage orchestration stays outside steps; model/tool effects are individually checkpointed. `flow-v2` is incompatible with historical execution order: new workers skip older queued histories, and the current API refuses incompatible resume. Keep matching releases for old-run recovery; never rewrite their manifests to pretend compatibility. See the deployment guide before activating this cutover.

[CrewAI's pinned production guidance](https://docs.crewai.com/v1.15.40/en/concepts/production-architecture.md) supports explicit flow control and focused crews. [Vercel Forma](https://vercel.com/kb/guide/v0-clone-openai-agents-vercel-sandbox) provides a first-party example of worker-owned build/preview checks, not evidence of v0's private internals. The [v0](../research/2026-11-13-v0-workflow.md) and [CrewAI](../research/2026-11-13-crewai-workflow.md) research records contain sources and limitations.
