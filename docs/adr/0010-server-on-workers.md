# ADR 0010: Worker with Drizzle D1 rather than PostgreSQL

Status: accepted, 2026-11-10.

## Context

The reference repository runs a Cloudflare Worker backed by PostgreSQL. Atoms already has a compact D1 data model for projects, messages, and immutable HTML versions. The requested inheritance is an engineering/design baseline, not a requirement to transplant unrelated database infrastructure.

## Decision

Retain Cloudflare Workers and **D1**, accessed through **Drizzle's D1/SQLite driver and schema**. Keep explicit checked-in SQL migrations with the server. Do not introduce PostgreSQL, connection pooling, or external relational-database infrastructure merely to mirror the reference runtime.

Ownership, current-version selection, run/lease exclusion and publication use D1 constraints, conditional writes and atomic batches. The API Worker remains the control plane; provider/browser execution runs on the GCP executor under [ADR-0012](0012-durable-agent-harness.md), with checkpoints and leases persisted in D1 through the API. Request handlers do not bootstrap schema.

## Why D1

- It preserves the original product's deployment/storage boundary and existing data semantics.
- The workload is a small owned-project store, not the reference's large cross-account analytical domain.
- A Worker binding removes external database credentials/network infrastructure from this demo.
- Drizzle provides typed schema/query boundaries while keeping SQL migration history explicit.

## Trade-offs

D1 is SQLite, not a drop-in PostgreSQL adapter. Do not assume advisory locks, row locks, arbitrary long transactions or driver-specific APIs. Design transitions around the actual D1 API and test migrations/constraints against local D1. Durability requires the explicit lease/checkpoint protocol; the database choice alone does not provide it.

If future requirements need capabilities D1 cannot meet, write a new decision with workload evidence and a data migration plan; do not silently add a second persistence backend.

## Release constraint

Local D1 is available without remote deployment. Creating or migrating a remote database requires the verified **Maqiqian0316@gmail.com's Account** and authorization for the specific writes. Reference or historical wrong-account database IDs must not be reused. GCP executor authorization is separate and does not authorize moving D1 to another account.
