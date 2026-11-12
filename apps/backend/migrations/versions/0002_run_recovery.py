"""Persist explicit recovery attempts and workflow compatibility.

Revision ID: 0002_run_recovery
"""

import sqlalchemy as sa
from alembic import op

revision = "0002_run_recovery"
down_revision = "0001_postgres"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Drain deferred references before DDL and validate backfills immediately.
    op.execute("SET CONSTRAINTS ALL IMMEDIATE")
    op.add_column("runs", sa.Column("attempt", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("runs", sa.Column("attempt_started_at", sa.BigInteger(), nullable=True))
    op.add_column(
        "runs",
        sa.Column("execution_version", sa.Text(), nullable=False, server_default="crew-v1"),
    )
    op.add_column(
        "runs",
        sa.Column("recovery_eligible", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE runs SET attempt_started_at = created_at")
    op.alter_column("runs", "attempt_started_at", nullable=False)
    # Historical selection changes must never be undone by resuming an older run.
    # Equal-time ambiguous histories fail closed instead of guessing run order.
    op.execute(
        """
        UPDATE runs AS candidate
        SET recovery_eligible = TRUE
        FROM projects AS project
        WHERE candidate.project_id = project.id
          AND candidate.previous_version_id IS NOT DISTINCT FROM project.current_version_id
          AND (project.run_id IS NULL OR project.run_id = candidate.id)
          AND NOT EXISTS (
              SELECT 1 FROM runs AS newer
              WHERE newer.project_id = candidate.project_id
                AND newer.id <> candidate.id
                AND newer.created_at >= candidate.created_at
          )
          AND NOT EXISTS (
              SELECT 1 FROM messages AS selection
              WHERE selection.project_id = candidate.project_id
                AND selection.role = 'system'
                AND selection.content LIKE 'Restored version %.'
                AND selection.created_at >= candidate.created_at
          )
        """
    )
    op.create_check_constraint("run_attempt_positive", "runs", "attempt >= 1")
    op.add_column(
        "run_events", sa.Column("attempt", sa.Integer(), nullable=False, server_default="1")
    )
    op.create_check_constraint("event_attempt_positive", "run_events", "attempt >= 1")


def downgrade() -> None:
    op.drop_constraint("event_attempt_positive", "run_events", type_="check")
    op.drop_column("run_events", "attempt")
    op.drop_constraint("run_attempt_positive", "runs", type_="check")
    op.drop_column("runs", "recovery_eligible")
    op.drop_column("runs", "execution_version")
    op.drop_column("runs", "attempt_started_at")
    op.drop_column("runs", "attempt")
