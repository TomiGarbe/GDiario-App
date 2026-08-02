"""add stability query indexes

Revision ID: c3d7f8a9e102
Revises: 6a3e2398fdaf
"""
from alembic import op


revision = "c3d7f8a9e102"
down_revision = "6a3e2398fdaf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Matches the most frequent list query: active movements ordered by date.
    # A partial index keeps soft-deleted history out of the hot path.
    with op.get_context().autocommit_block():
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_movements_active_date_created "
            "ON movements (date, created_at, id) WHERE deleted_at IS NULL"
        )
        # Enables the outbox poller to find due jobs without scanning its history.
        op.execute(
            "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_sheet_sync_jobs_due_ordered "
            "ON sheet_sync_jobs (status, next_retry_at, created_at, id)"
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_sheet_sync_jobs_due_ordered")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_movements_active_date_created")
