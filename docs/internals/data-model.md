# Data model and lifecycle

The server's Drizzle schema and checked-in D1 migrations define fields and constraints. This document records relationships and invariants that field lists alone do not explain; avoid maintaining a second schema dictionary.

## Project boundary

A project belongs to an anonymous browser owner. All private operations resolve the project under that owner before accessing its messages or versions. Public publication is a separate lookup and exposes only the selected HTML. Anonymous ownership is a demo boundary, not a full account/session system.

## Conversation and generation

Messages preserve user requests, agent output and system feedback. D1 `runs` stores status, active-run fencing, the persisted 15-minute deadline and executor lease fields. `run_events` stores sequence-addressed observations with idempotent event identities. The Node executor owns model/browser execution; SSE reads events. Reconnect requests events after the last cursor without starting a new run.

The bearer-authenticated executor API grants a 60-second lease refreshed every 10 seconds. Lease tokens condition checkpoint/event/completion writes; an expired lease can be reclaimed. `run_checkpoints` stores immutable named step results, persisted before advancing and reused after restart. A checkpoint is not a provider token-stream snapshot, and an interrupted step can repeat provider calls.

Cancellation fences writes immediately; the executor aborts when heartbeat authority is lost. Conditional writes reject stale, cancelled and expired producers, including late tool results. Timeout, provider failure and validation failure differ from explicit cancellation. Draft artifacts are not successful versions; completion requires current-artifact browser evidence and independent review.

The server repository/service boundary uses `db/schema.ts`. Preserve migration history through `0005_project_sources.sql`, which backfills old versions into explicit Vanilla source snapshots while retaining their original HTML and IDs. Stop old executors and drain active runs before the source-aware cutover; legacy checkpoints do not contain the new source/build contract. Requests do not create schema. See [deployment](../operations/deployment.md) for cutover ordering.

## Three version selections

- **Current:** `currentVersionId`, the immutable source snapshot used as the starting point for a follow-up.
- **Viewed:** local UI selection when inspecting history; viewing alone does not change persisted current state.
- **Published:** `publishedVersionId`, the explicit saved result exposed by the public slug.

A built, browser-validated and independently accepted generation atomically saves immutable source plus its compiled preview and updates current. A failed generation leaves the previous complete current version intact. Restore selects both parts of a saved version as current; it does not rewrite that version or change the published pointer. Republish deliberately updates the public pointer. Unpublish clears public access without deleting private history.

Undo selects the current version's recorded generation parent directly, without a confirmation dialog. It does not use version-number order: generating v4 after restoring v1 from v3 makes v1 the undo target. The parent is saved atomically with completion and retained across reloads. Remix maps parent IDs into its own copied history. Migration `0006_version_ancestry.sql` recovers ancestry from retained originating runs; legacy copies without such records have no inferred undo target and remain accessible through manual history restore. The toolbar keeps Undo visible and disables it when no parent is available or a conflicting operation is active.

Remix creates independent project/message/version identities and selects the requested historical version, or current version when omitted. It must not share mutable pointers with the source or accidentally inherit public ownership. Download returns the complete source ZIP for the requested authorized saved version. Public links expose only its frozen compiled preview, never its private conversation or source API.

## D1 implementation constraints

Use Drizzle's SQLite/D1 schema and supported D1 operations. Enforce unique project-local version numbers and publication slugs with database constraints where represented in the schema. Multi-write publication/version operations require supported atomic batches or equivalent conditional operations; PostgreSQL row locks and advisory locks are not available.

Schema migrations are explicit local or authorized remote operations. Do not create tables inside request handlers or use startup SQL as a replacement for migration history. See [ADR-0010](../adr/0010-server-on-workers.md) for the decision to retain D1 rather than transplant the reference database platform.
