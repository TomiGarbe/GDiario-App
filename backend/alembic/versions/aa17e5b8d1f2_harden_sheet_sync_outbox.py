"""harden sheet sync outbox

Revision ID: aa17e5b8d1f2
Revises: 9a7d4b2e6c31
Create Date: 2026-07-27 00:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "aa17e5b8d1f2"
down_revision: Union[str, Sequence[str], None] = "9a7d4b2e6c31"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL enums are append-only in production.  Keep the legacy values
    # readable, but all new code writes only the five explicit states below.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE sheet_sync_status ADD VALUE IF NOT EXISTS 'PROCESSING'")
        op.execute("ALTER TYPE sheet_sync_status ADD VALUE IF NOT EXISTS 'SYNCED'")
        op.execute("ALTER TYPE sheet_sync_status ADD VALUE IF NOT EXISTS 'TEMPORARY_ERROR'")
        op.execute("ALTER TYPE sheet_sync_status ADD VALUE IF NOT EXISTS 'DEFINITIVE_ERROR'")
    op.execute("UPDATE sheet_sync_jobs SET status = 'SYNCED' WHERE status = 'SUCCEEDED'")
    op.execute("UPDATE sheet_sync_jobs SET status = 'TEMPORARY_ERROR' WHERE status = 'FAILED'")
    op.alter_column("sheet_sync_jobs", "max_attempts", server_default=sa.text("6"))
    op.add_column("sheet_sync_jobs", sa.Column("error_stack_trace", sa.Text(), nullable=True))
    op.add_column("sheet_sync_jobs", sa.Column("error_http_status", sa.Integer(), nullable=True))
    op.add_column("sheet_sync_jobs", sa.Column("error_http_response", sa.Text(), nullable=True))
    op.add_column("sheet_sync_jobs", sa.Column("movement_type", sa.Text(), nullable=True))
    op.add_column("sheet_sync_jobs", sa.Column("company_name", sa.Text(), nullable=True))
    op.add_column("sheet_sync_jobs", sa.Column("client_names", sa.Text(), nullable=True))
    op.add_column("sheet_sync_jobs", sa.Column("employee_names", sa.Text(), nullable=True))
    op.add_column("sheet_sync_jobs", sa.Column("movement_description", sa.Text(), nullable=True))
    op.add_column("sheet_sync_jobs", sa.Column("movement_date", sa.Date(), nullable=True))
    op.add_column("sheet_sync_jobs", sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_sheet_sync_jobs_processing_started_at", "sheet_sync_jobs", ["processing_started_at"], unique=False)
    op.create_index("ix_sheet_sync_jobs_due", "sheet_sync_jobs", ["status", "next_retry_at"], unique=False)
    op.add_column("movements", sa.Column("sheet_sync_status", sa.Text(), server_default=sa.text("'synced'"), nullable=False))
    op.create_index("ix_movements_sheet_sync_status", "movements", ["sheet_sync_status"], unique=False)
    op.execute(
        """UPDATE movements AS m SET sheet_sync_status = 'pending'
           WHERE EXISTS (
             SELECT 1 FROM sheet_sync_jobs AS j
             WHERE j.movement_id = m.id
               AND j.status IN ('PENDING', 'PROCESSING', 'TEMPORARY_ERROR', 'DEFINITIVE_ERROR')
           )"""
    )


def downgrade() -> None:
    op.drop_index("ix_movements_sheet_sync_status", table_name="movements")
    op.drop_column("movements", "sheet_sync_status")
    op.drop_index("ix_sheet_sync_jobs_due", table_name="sheet_sync_jobs")
    op.drop_index("ix_sheet_sync_jobs_processing_started_at", table_name="sheet_sync_jobs")
    for column in ("processing_started_at", "movement_date", "movement_description", "employee_names", "client_names", "company_name", "movement_type", "error_http_response", "error_http_status", "error_stack_trace"):
        op.drop_column("sheet_sync_jobs", column)
    op.alter_column("sheet_sync_jobs", "max_attempts", server_default=sa.text("5"))
