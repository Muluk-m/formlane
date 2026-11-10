# ADR 0010: Worker with Drizzle D1 rather than PostgreSQL

Status: accepted, 2026-11-10.

## Context

The reference repository runs a Cloudflare Worker backed by PostgreSQL. Atoms already has a compact D1 data model for projects, messages, and immutable HTML versions. The requested inheritance is an engineering/design baseline, not a requirement to transplant unrelated database infrastructure.

## Decision

Retain Cloudflare Workers and **D1**, accessed through **Drizzle's D1/SQLite driver and schema**. Keep explicit checked-in SQL migrations with the server. Do not introduce PostgreSQL, connection pooling, or external relational-database infrastructure merely to mirror the reference runtime.

Ownership, current-version selection, generation exclusion, and publication are enforced with D1-supported constraints, conditional writes, and atomic batches where necessary. Provider streaming runs outside database write batches. The request handler does not bootstrap schema with CREATE statements.

## Why D1

- It preserves the original product's deployment/storage boundary and existing data semantics.
- The workload is a small owned-project store, not the reference's large cross-account analytical domain.
- A Worker binding removes external database credentials/network infrastructure from this demo.
- Drizzle provides typed schema/query boundaries while keeping SQL migration history explicit.

## Trade-offs

D1 is SQLite, not a drop-in PostgreSQL adapter. Do not assume advisory locks, row locks, arbitrary long transactions, or driver-specific APIs. Design multi-write state transitions around the actual D1 API, and test migrations/constraints against local D1. Request-bound model execution is not made durable by the database choice.

If future requirements need capabilities D1 cannot meet, write a new decision with workload evidence and a data migration plan; do not silently add a second persistence backend.

## Release constraint

Local D1 is available without a remote deployment. Creating or migrating a remote database remains blocked until **Maqiqian0316@gmail.com's Account** is accessible, its ID verified, and the user authorizes writes. Reference or historical wrong-account database IDs must not be reused.
