"""add sheet sync jobs

Revision ID: 9a7d4b2e6c31
Revises: 5f2b8e8e9c11
Create Date: 2026-07-07 00:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "9a7d4b2e6c31"
down_revision: Union[str, Sequence[str], None] = "5f2b8e8e9c11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    sheet_sync_action = postgresql.ENUM("CREATE", "UPDATE", "DELETE", name="sheet_sync_action", create_type=False)
    sheet_sync_status = postgresql.ENUM("PENDING", "FAILED", "SUCCEEDED", name="sheet_sync_status", create_type=False)
    sheet_sync_action.create(op.get_bind(), checkfirst=True)
    sheet_sync_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "sheet_sync_jobs",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("movement_id", sa.UUID(), nullable=False),
        sa.Column("period_id", sa.Integer(), nullable=False),
        sa.Column("sheet_id", sa.Text(), nullable=False),
        sa.Column("action", sheet_sync_action, nullable=False),
        sa.Column("status", sheet_sync_status, server_default=sa.text("'PENDING'"), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("max_attempts", sa.Integer(), server_default=sa.text("5"), nullable=False),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["movement_id"], ["movements.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sheet_sync_jobs_action"), "sheet_sync_jobs", ["action"], unique=False)
    op.create_index(op.f("ix_sheet_sync_jobs_movement_id"), "sheet_sync_jobs", ["movement_id"], unique=False)
    op.create_index(op.f("ix_sheet_sync_jobs_next_retry_at"), "sheet_sync_jobs", ["next_retry_at"], unique=False)
    op.create_index(op.f("ix_sheet_sync_jobs_period_id"), "sheet_sync_jobs", ["period_id"], unique=False)
    op.create_index(op.f("ix_sheet_sync_jobs_status"), "sheet_sync_jobs", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_sheet_sync_jobs_status"), table_name="sheet_sync_jobs")
    op.drop_index(op.f("ix_sheet_sync_jobs_period_id"), table_name="sheet_sync_jobs")
    op.drop_index(op.f("ix_sheet_sync_jobs_next_retry_at"), table_name="sheet_sync_jobs")
    op.drop_index(op.f("ix_sheet_sync_jobs_movement_id"), table_name="sheet_sync_jobs")
    op.drop_index(op.f("ix_sheet_sync_jobs_action"), table_name="sheet_sync_jobs")
    op.drop_table("sheet_sync_jobs")

    sa.Enum(name="sheet_sync_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="sheet_sync_action").drop(op.get_bind(), checkfirst=True)
