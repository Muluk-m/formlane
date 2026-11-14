"""Private immutable selection evidence on existing Run and Message records.

Revision ID: 0005_selection_evidence
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005_selection_evidence"
down_revision = "0004_version_acceptance_checks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable additions need no data rewrite/backfill on populated histories.
    op.add_column("runs", sa.Column("selection", postgresql.JSONB(), nullable=True))
    op.add_column("messages", sa.Column("selection_summary", postgresql.JSONB(), nullable=True))
    op.create_check_constraint(
        "run_selection_binding",
        "runs",
        "selection IS NULL OR (jsonb_typeof(selection) = 'object' "
        "AND selection->>'projectId' = project_id "
        "AND selection->>'versionId' = previous_version_id "
        "AND selection ?& ARRAY['projectId','versionId','selectionId','evidence','sourceResolutions'] "
        "AND previous_version_id IS NOT NULL "
        "AND octet_length(selection::text) <= 3145728)",
    )
    op.execute("""
        CREATE FUNCTION preserve_run_selection() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.selection IS DISTINCT FROM OLD.selection THEN
                RAISE EXCEPTION 'Run selection is immutable';
            END IF;
            RETURN NEW;
        END;
        $$
    """)
    op.execute("""
        CREATE TRIGGER run_selection_immutable BEFORE UPDATE OF selection ON runs
        FOR EACH ROW EXECUTE FUNCTION preserve_run_selection()
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER run_selection_immutable ON runs")
    op.execute("DROP FUNCTION preserve_run_selection()")
    op.drop_constraint("run_selection_binding", "runs", type_="check")
    op.drop_column("messages", "selection_summary")
    op.drop_column("runs", "selection")
