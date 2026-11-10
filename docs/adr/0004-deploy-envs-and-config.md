# ADR 0004: Verified account and fail-closed deployment

Status: accepted; release blocked pending designated account access, 2026-11-10.

## Context

A prior deployment used a wrong Cloudflare account. The currently observed company-account dashboard does not expose the required Gmail account. Historical public URLs cannot establish correct resource ownership.

## Decision

The sole authorized target is **Maqiqian0316@gmail.com's Account**. Its immutable account ID remains unverified until authoritative account access is available. Account/resource configuration lives in `deploy/environments.json`; unknown account/database IDs stay unset. A deployment guard must match account ID and exact account name and refuse a fallback identity before performing any cloud write.

Use the guarded root deployment command; its default inspection mode is not deployment. Remote migrations, secrets, and deployment each require authorization and verified resources. Local Wrangler/D1 development does not require adopting a wrong remote identity.

## Consequences

No production URL is claimed until the correct account, resource, deployed artifact, and smoke behavior are verified. Prior wrong-account deployments are not a deliverable. The account-access blocker is explicit in README and the [deployment procedure](../operations/deployment.md), not hidden behind a plausible resource ID.
