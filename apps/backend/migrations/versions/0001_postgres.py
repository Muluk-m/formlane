"""PostgreSQL authority and per-run transactional event cursors.

Revision ID: 0001_postgres
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001_postgres"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("owner_id", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("idea", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="idle"),
        sa.Column("error", sa.Text()),
        sa.Column("current_version_id", sa.Text()),
        sa.Column("published_slug", sa.Text(), unique=True),
        sa.Column("published_version_id", sa.Text()),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("run_id", sa.Text()),
        sa.CheckConstraint("status IN ('idle','generating','error')", name="project_status"),
    )
    op.create_index("idx_projects_owner", "projects", ["owner_id", "updated_at"])
    op.create_table(
        "messages",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Text(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column("agent", sa.Text()),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("position", sa.BigInteger(), sa.Identity(), nullable=False, unique=True),
        sa.CheckConstraint("role IN ('user','agent','system')", name="message_role"),
    )
    op.create_index("idx_messages_project", "messages", ["project_id", "created_at", "position"])
    op.create_table(
        "versions",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Text(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("html", sa.Text(), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("source", postgresql.JSONB(), nullable=False),
        sa.Column("parent_version_id", sa.Text()),
        sa.UniqueConstraint("project_id", "number", name="idx_versions_number"),
        sa.UniqueConstraint("project_id", "id", name="version_project_identity"),
        sa.CheckConstraint("number > 0", name="version_positive_number"),
        sa.ForeignKeyConstraint(
            ["project_id", "parent_version_id"],
            ["versions.project_id", "versions.id"],
            name="version_parent",
            deferrable=True,
            initially="DEFERRED",
        ),
    )
    op.create_table(
        "runs",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column(
            "project_id",
            sa.Text(),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("request", sa.Text(), nullable=False),
        sa.Column("previous_version_id", sa.Text()),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("started_at", sa.BigInteger()),
        sa.Column("finished_at", sa.BigInteger()),
        sa.Column("deadline_at", sa.BigInteger(), nullable=False),
        sa.Column("error_code", sa.Text()),
        sa.Column("error", sa.Text()),
        sa.Column("version_id", sa.Text()),
        sa.Column("lease_token", sa.Text()),
        sa.Column("lease_owner", sa.Text()),
        sa.Column("lease_expires_at", sa.BigInteger()),
        sa.Column("event_cursor", sa.BigInteger(), nullable=False, server_default="0"),
        sa.UniqueConstraint("project_id", "id", name="run_project_identity"),
        sa.CheckConstraint(
            "status IN ('queued','running','completed','failed','cancelled')", name="run_status"
        ),
        sa.CheckConstraint("event_cursor >= 0", name="run_cursor_nonnegative"),
        sa.ForeignKeyConstraint(
            ["project_id", "previous_version_id"],
            ["versions.project_id", "versions.id"],
            name="run_previous_version",
            deferrable=True,
            initially="DEFERRED",
        ),
        sa.ForeignKeyConstraint(
            ["project_id", "version_id"],
            ["versions.project_id", "versions.id"],
            name="run_result_version",
            deferrable=True,
            initially="DEFERRED",
        ),
    )
    op.create_index("idx_runs_project", "runs", ["project_id", "created_at"])
    op.create_index("idx_runs_queue", "runs", ["status", "lease_expires_at", "created_at"])
    op.create_table(
        "run_events",
        sa.Column(
            "run_id", sa.Text(), sa.ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("sequence", sa.BigInteger(), primary_key=True, autoincrement=False),
        sa.Column("event_key", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.UniqueConstraint("run_id", "event_key", name="idx_run_events_key"),
        sa.CheckConstraint("sequence > 0", name="event_positive_sequence"),
    )
    op.create_table(
        "run_checkpoints",
        sa.Column(
            "run_id", sa.Text(), sa.ForeignKey("runs.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("name", sa.Text(), primary_key=True),
        sa.Column("result", postgresql.JSONB(none_as_null=False), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    for name, column, target in [
        ("project_current_version", "current_version_id", "versions"),
        ("project_published_version", "published_version_id", "versions"),
        ("project_active_run", "run_id", "runs"),
    ]:
        op.create_foreign_key(
            name,
            "projects",
            target,
            ["id", column],
            ["project_id", "id"],
            deferrable=True,
            initially="DEFERRED",
        )


def downgrade() -> None:
    for name in ["project_current_version", "project_published_version", "project_active_run"]:
        op.drop_constraint(name, "projects", type_="foreignkey")
    for table in ["run_checkpoints", "run_events", "runs", "versions", "messages", "projects"]:
        op.drop_table(table)
