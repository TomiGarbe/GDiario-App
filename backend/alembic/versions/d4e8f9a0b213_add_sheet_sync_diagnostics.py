"""add sheet sync diagnostics

Revision ID: d4e8f9a0b213
Revises: c3d7f8a9e102
"""
from alembic import op
import sqlalchemy as sa


revision = "d4e8f9a0b213"
down_revision = "c3d7f8a9e102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sheet_sync_jobs", sa.Column("last_step", sa.Text(), nullable=True))
    op.add_column("sheet_sync_jobs", sa.Column("timings_json", sa.Text(), nullable=True))
    op.add_column("sheet_sync_jobs", sa.Column("failure_history_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("sheet_sync_jobs", "failure_history_json")
    op.drop_column("sheet_sync_jobs", "timings_json")
    op.drop_column("sheet_sync_jobs", "last_step")
