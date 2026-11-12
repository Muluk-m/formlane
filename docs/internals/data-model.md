# Data model and lifecycle

[SQLAlchemy models](../../apps/backend/src/formlane/models.py), [storage](../../apps/backend/src/formlane/storage.py) and [Alembic migrations](../../apps/backend/migrations/) define the six business tables. DBOS owns its separate workflow/operation history schema in PostgreSQL; both are part of recovery backups and require explicit migrations.

| Table             | Authority                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| `projects`        | Anonymous owner, idea, current/published pointers, public slug and active-run fence                |
| `messages`        | Conversation, including stable ordering for equal timestamps                                       |
| `versions`        | Immutable source/HTML snapshots, project-local numbers and generation ancestry                     |
| `runs`            | Request/baseline, status, attempt/deadline, execution compatibility, eligibility, lease and cursor |
| `run_events`      | Sequence-addressed observations tagged with execution attempt and idempotent event identity        |
| `run_checkpoints` | Retained legacy completed-step results consumed during DBOS migration                              |

IDs retain their historical text identity and timestamps remain epoch milliseconds. JSONB stores structured source/events/checkpoints. Schema changes require explicit Alembic migrations; application startup and requests never create tables.

## Ownership and execution

Every private operation first resolves the project under its anonymous browser owner. Public slug lookup exposes only explicitly published HTML, never private conversation, source or ownership capabilities.

The worker claims a 60-second lease refreshed every 10 seconds. Transactions and locks protect ownership, active-run selection, attempts, events and completion. Stale, expired or cancelled producers cannot write. Automatic reclaim retains the attempt deadline; SSE reconnection only observes. Explicit resume atomically keeps the run ID and committed work, increments its attempt, clears terminal failure and grants a new bounded deadline. Active duplicate resume requests are idempotent. New runs, version restores and incompatible execution history invalidate recovery eligibility.

DBOS records completed model/tool operations, not interrupted provider token streams. Uncommitted calls may repeat. Workflow compatibility is pinned across replay. Each event carries an attempt and the cursor remains monotonic across attempts, preventing historical terminal events from settling resumed execution. Failure categories distinguish timeout, provider, validation, step-limit and internal failures. Completion still requires current-source build, implementation validation, independent validation and explicit review.

## Version selections and ancestry

- **Current** (`currentVersionId`) selects the immutable source baseline for the next follow-up.
- **Viewed** is local historical inspection and does not mutate persisted pointers.
- **Published** (`publishedVersionId`) pins the public slug to one explicitly chosen saved result.

Completion atomically saves source, compiled HTML and recorded parent and updates current. Restore selects an existing version without deleting later versions or publishing it. Undo directly selects the current version's recorded generation parent: generating v4 after restoring v1 makes v1 its parent, regardless of version numbering. Republish updates the frozen public selection; unpublish revokes it without deleting history.

Remix creates independent project/message/version identities, maps ancestry within its copied history and selects the requested historical/current version. It does not inherit public ownership. Downloads contain the authorized selected version's complete runnable source. Generated applications' interactive state remains in-memory preview state, separate from persisted project history.

## D1 migration fidelity

The [importer](../../apps/backend/src/formlane/import_d1.py) accepts exact six-table exports from the source-aware D1 schema (historical migrations 0005/0006). It preserves owners, IDs, timestamps, source/HTML, current/published/active-run pointers, messages, event sequence/history and checkpoints. PostgreSQL-specific message positions retain export ordering for timestamp ties; run cursors match the retained event maxima.

Recovery metadata absent from legacy D1 exports is initialized separately: first attempt, original creation time as attempt start, legacy execution version and conservative current-baseline eligibility. Hash verification projects only the original D1 columns; it does not rewrite old event payloads or infer new model results.

Only a missing pre-0006 `parent_version_id` is normalized. Match the version's recorded originating run and its retained same-project previous version; otherwise retain a null parent. Explicit parents are preserved. Never infer ancestry from numbering or fabricate parents for legacy remix roots. Hash manifests state this policy so normalization is visible rather than mistaken for byte-for-byte raw schema equality.

Import uses one transaction and verifies canonical per-table hashes/counts, source/HTML hashes, message ordering and cursors. A populated target must already match exactly; differing data is rejected rather than merged or overwritten. `--verify-only` never inserts rows. Use an empty production target after fencing/draining/exporting the old authority; staging rehearsal data is not the final production snapshot. See [deployment](../operations/deployment.md#static-pages-python-api-cutover) for the cutover and coherent rollback boundary.
