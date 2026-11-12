"""Remove the whole-run wall-clock deadline.

Revision ID: 0003_remove_run_deadline
"""

import sqlalchemy as sa
from alembic import op

revision = "0003_remove_run_deadline"
down_revision = "0002_run_recovery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("runs", "deadline_at")


def downgrade() -> None:
    op.add_column("runs", sa.Column("deadline_at", sa.BigInteger(), nullable=True))
    op.execute(
        "UPDATE runs SET deadline_at = (extract(epoch FROM clock_timestamp()) * 1000)::bigint + 900000"
    )
    op.alter_column("runs", "deadline_at", nullable=False)
