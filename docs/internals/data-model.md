# Data model and lifecycle

The server's Drizzle schema and checked-in D1 migrations define fields and constraints. This document records relationships and invariants that field lists alone do not explain; avoid maintaining a second schema dictionary.

## Project boundary

A project belongs to an anonymous browser owner. All private operations resolve the project under that owner before accessing its messages or versions. Public publication is a separate lookup and exposes only the selected HTML. Anonymous ownership is a demo boundary, not a full account/session system.

## Conversation and generation

Messages preserve user requests, agent output, and system feedback. Streamed text can exist before a complete generated version does. An active run is associated with project state; stale or cancelled work must not publish a result over a newer run. The generation request owns provider execution rather than a durable queue.

The server's `modules/projects` repository/service boundary uses `db/schema.ts`. The original `0001_init.sql` is retained; `0002_run_fence.sql` adds nullable run identity so writes can be associated with the active generation. Migration history, not request-time schema creation, establishes these fields.

## Three version selections

- **Current:** `currentVersionId`, the saved HTML used as the starting point for a follow-up.
- **Viewed:** local UI selection when inspecting history; viewing alone does not change persisted current state.
- **Published:** `publishedVersionId`, the explicit saved result exposed by the public slug.

A complete generation creates an immutable HTML version and updates current. A failed generation leaves the previous complete current version intact. Restore selects a saved version as current; it does not rewrite that version or change the published pointer. Republish deliberately updates the public pointer. Unpublish clears public access without deleting private history.

Remix creates independent project/message/version identities. It must not share mutable pointers with the source or accidentally inherit public ownership. Download chooses the requested authorized saved version, including a historical one when that is what the UI is showing.

## D1 implementation constraints

Use Drizzle's SQLite/D1 schema and supported D1 operations. Enforce unique project-local version numbers and publication slugs with database constraints where represented in the schema. Multi-write publication/version operations require supported atomic batches or equivalent conditional operations; PostgreSQL row locks and advisory locks are not available.

Schema migrations are explicit local or authorized remote operations. Do not create tables inside request handlers or use startup SQL as a replacement for migration history. See [ADR-0010](../adr/0010-server-on-workers.md) for the decision to retain D1 rather than transplant the reference database platform.
