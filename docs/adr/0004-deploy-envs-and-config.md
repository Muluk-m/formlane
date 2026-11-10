# ADR 0004: Verified account and fail-closed deployment

Status: accepted, 2026-11-10; designated account subsequently verified.

## Context

A prior deployment used a wrong Cloudflare account, and initial account access did not expose the required Gmail target. Historical public URLs cannot establish correct resource ownership. The designated account was subsequently verified; this does not waive release-specific checks.

## Decision

The sole authorized Cloudflare target is **Maqiqian0316@gmail.com's Account**, verified as `252fba810f75c0370e5aa7200abc8f80`. Account/resource configuration lives in `deploy/environments.json`; unknown resource IDs stay unset. The Cloudflare guard must match ID and exact account name before cloud writes. The separately approved GCP executor identity and budget boundary are recorded in [ADR-0012](0012-durable-agent-harness.md) and [deployment](../operations/deployment.md); they do not change the Cloudflare target.

Use the guarded root deployment command; its default inspection mode is not deployment. Remote migrations, secrets, and deployment each require authorization and verified resources. Local Wrangler/D1 development does not require adopting a wrong remote identity.

## Consequences

Claim a production release only after the correct account, resources, deployed artifact and smoke behavior are verified. Prior wrong-account deployments are not a deliverable. The [deployment procedure](../operations/deployment.md) distinguishes predecessor evidence from current durable-harness acceptance; an existing URL is not proof that a rewrite passed.
