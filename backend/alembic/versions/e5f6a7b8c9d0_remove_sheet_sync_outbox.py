"""remove Sheet Sync outbox

Revision ID: e5f6a7b8c9d0
Revises: d4e8f9a0b213
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "e5f6a7b8c9d0"
down_revision = "d4e8f9a0b213"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Remove the automatic PostgreSQL-to-Sheets projection state."""
    op.drop_column("movements", "sheet_sync_status")
    op.drop_table("sheet_sync_jobs")
    op.execute("DROP TYPE IF EXISTS sheet_sync_status")
    op.execute("DROP TYPE IF EXISTS sheet_sync_action")


def downgrade() -> None:
    """Restore the former schema for a rollback to the previous release."""
    action = postgresql.ENUM("CREATE", "UPDATE", "DELETE", name="sheet_sync_action")
    status = postgresql.ENUM(
        "PENDING", "FAILED", "SUCCEEDED", "PROCESSING", "SYNCED",
        "TEMPORARY_ERROR", "DEFINITIVE_ERROR", name="sheet_sync_status",
    )
    action.create(op.get_bind(), checkfirst=True)
    status.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "movements",
        sa.Column("sheet_sync_status", sa.Text(), server_default=sa.text("'synced'"), nullable=False),
    )
    op.create_index("ix_movements_sheet_sync_status", "movements", ["sheet_sync_status"])
    op.create_table(
        "sheet_sync_jobs",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("movement_id", sa.UUID(), nullable=False),
        sa.Column("period_id", sa.Integer(), nullable=False),
        sa.Column("sheet_id", sa.Text(), nullable=False),
        sa.Column("action", action, nullable=False),
        sa.Column("status", status, server_default=sa.text("'PENDING'"), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("max_attempts", sa.Integer(), server_default=sa.text("6"), nullable=False),
        sa.Column("next_retry_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.Text()),
        sa.Column("error_stack_trace", sa.Text()),
        sa.Column("error_http_status", sa.Integer()),
        sa.Column("error_http_response", sa.Text()),
        sa.Column("last_step", sa.Text()),
        sa.Column("timings_json", sa.Text()),
        sa.Column("failure_history_json", sa.Text()),
        sa.Column("payload_json", sa.Text()),
        sa.Column("movement_type", sa.Text()),
        sa.Column("company_name", sa.Text()),
        sa.Column("client_names", sa.Text()),
        sa.Column("employee_names", sa.Text()),
        sa.Column("movement_description", sa.Text()),
        sa.Column("movement_date", sa.Date()),
        sa.Column("processing_started_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(["movement_id"], ["movements.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in {
        "ix_sheet_sync_jobs_action": ["action"],
        "ix_sheet_sync_jobs_movement_id": ["movement_id"],
        "ix_sheet_sync_jobs_period_id": ["period_id"],
        "ix_sheet_sync_jobs_status": ["status"],
        "ix_sheet_sync_jobs_next_retry_at": ["next_retry_at"],
        "ix_sheet_sync_jobs_processing_started_at": ["processing_started_at"],
        "ix_sheet_sync_jobs_due": ["status", "next_retry_at"],
    }.items():
        op.create_index(name, "sheet_sync_jobs", columns)
