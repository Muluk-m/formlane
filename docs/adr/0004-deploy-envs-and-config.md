# ADR 0004: Verified account and fail-closed deployment

Status: accepted, 2026-11-10; designated account subsequently verified.

## Context

A prior deployment used a wrong Cloudflare account, and initial account access did not expose the required Gmail target. Historical public URLs cannot establish correct resource ownership. The designated account was subsequently verified; this does not waive release-specific checks.

## Decision

The sole authorized Cloudflare target is **Maqiqian0316@gmail.com's Account**, verified as `252fba810f75c0370e5aa7200abc8f80`. Account/resource configuration lives in `deploy/environments.json`; unknown targets stay unset. The Cloudflare guard must match ID and exact account name before cloud writes. The separately approved GCP account/project/VM and reserved HTTPS API identity are recorded in [deployment](../operations/deployment.md); they do not change the Cloudflare target.

Use the guarded root deployment command for static Pages; its default inspection mode does not deploy. Python services, PostgreSQL/Alembic, imports and secrets have their own authorized operational steps. Set `backendReady` only after accepted backend/data state, including final write-fenced import; readiness does not itself authorize deployment. Keep one writable database authority during activation and rollback.

## Consequences

Claim a production release only after the correct account, resources, deployed artifact and smoke behavior are verified. Prior wrong-account deployments are not a deliverable. The [deployment procedure](../operations/deployment.md) distinguishes predecessor evidence from current durable-harness acceptance; an existing URL is not proof that a rewrite passed.
