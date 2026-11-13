"""Persist each version's accepted check set for follow-up regression.

Revision ID: 0004_version_acceptance_checks
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004_version_acceptance_checks"
down_revision = "0003_remove_run_deadline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "versions",
        sa.Column("acceptance_checks", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("versions", "acceptance_checks")
