# Data model and lifecycle

[SQLAlchemy models](../../apps/backend/src/formlane/models.py), [storage](../../apps/backend/src/formlane/storage.py) and [Alembic migrations](../../apps/backend/migrations/) define the PostgreSQL schema. PostgreSQL is the replacement system's sole business authority; Alembic's version bookkeeping is separate from the six business tables.

| Table             | Authority                                                                           |
| ----------------- | ----------------------------------------------------------------------------------- |
| `projects`        | Anonymous owner, idea, current/published pointers, public slug and active-run fence |
| `messages`        | Conversation, including stable ordering for equal timestamps                        |
| `versions`        | Immutable source/HTML snapshots, project-local numbers and generation ancestry      |
| `runs`            | Status, request/baseline, deadline, lease and durable event cursor                  |
| `run_events`      | Sequence-addressed observations with idempotent event identities                    |
| `run_checkpoints` | Immutable named completed-step results                                              |

IDs retain their historical text identity and timestamps remain epoch milliseconds. JSONB stores structured source/events/checkpoints. Schema changes require explicit Alembic migrations; application startup and requests never create tables.

## Ownership and execution

Every private operation first resolves the project under its anonymous browser owner. Public slug lookup exposes only explicitly published HTML, never private conversation, source or ownership capabilities.

The worker claims a 60-second lease refreshed every 10 seconds. PostgreSQL transactions, locking and conditional checks protect active-run exclusion, events, checkpoints and completion. Stale, expired or cancelled producers cannot write, including late tool results. The persisted 15-minute deadline survives restart/reclaim. SSE only reads persisted observations; reconnect does not start a run.

Checkpoints preserve completed steps, not an interrupted provider token stream. In-flight model calls can repeat. Failure categories distinguish timeout, provider, validation, step-limit and internal failures from cancellation. Successful completion requires current-source build, implementation validation, independent browser validation and explicit review; drafts never become successful versions by themselves.

## Version selections and ancestry

- **Current** (`currentVersionId`) selects the immutable source baseline for the next follow-up.
- **Viewed** is local historical inspection and does not mutate persisted pointers.
- **Published** (`publishedVersionId`) pins the public slug to one explicitly chosen saved result.

Completion atomically saves source, compiled HTML and recorded parent and updates current. Restore selects an existing version without deleting later versions or publishing it. Undo directly selects the current version's recorded generation parent: generating v4 after restoring v1 makes v1 its parent, regardless of version numbering. Republish updates the frozen public selection; unpublish revokes it without deleting history.

Remix creates independent project/message/version identities, maps ancestry within its copied history and selects the requested historical/current version. It does not inherit public ownership. Downloads contain the authorized selected version's complete runnable source. Generated applications' interactive state remains in-memory preview state, separate from persisted project history.

## D1 migration fidelity

The [importer](../../apps/backend/src/formlane/import_d1.py) accepts exact six-table exports from the source-aware D1 schema (historical migrations 0005/0006). It preserves owners, IDs, timestamps, source/HTML, current/published/active-run pointers, messages, event sequence/history and checkpoints. PostgreSQL-specific message positions retain export ordering for timestamp ties; run cursors match the retained event maxima.

Only a missing pre-0006 `parent_version_id` is normalized. Match the version's recorded originating run and its retained same-project previous version; otherwise retain a null parent. Explicit parents are preserved. Never infer ancestry from numbering or fabricate parents for legacy remix roots. Hash manifests state this policy so normalization is visible rather than mistaken for byte-for-byte raw schema equality.

Import uses one transaction and verifies canonical per-table hashes/counts, source/HTML hashes, message ordering and cursors. A populated target must already match exactly; differing data is rejected rather than merged or overwritten. `--verify-only` never inserts rows. Use an empty production target after fencing/draining/exporting the old authority; staging rehearsal data is not the final production snapshot. See [deployment](../operations/deployment.md#static-pages-python-api-cutover) for the cutover and coherent rollback boundary.
