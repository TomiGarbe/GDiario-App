"""add pago_cliente and movement_client_payments table

Revision ID: a7f4e1c2b9d8
Revises: 2d7f3c1a9b10
Create Date: 2026-05-01 18:10:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "a7f4e1c2b9d8"
down_revision = "2d7f3c1a9b10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'pago_cliente'")

    op.create_table(
        "movement_client_payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("movement_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("subtotal", sa.Numeric(precision=14, scale=4), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["movement_id"], ["movements.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_movement_client_payments_movement_id",
        "movement_client_payments",
        ["movement_id"],
        unique=False,
    )
    op.create_index(
        "ix_movement_client_payments_client_id",
        "movement_client_payments",
        ["client_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_movement_client_payments_client_id", table_name="movement_client_payments")
    op.drop_index("ix_movement_client_payments_movement_id", table_name="movement_client_payments")
    op.drop_table("movement_client_payments")
    # PostgreSQL does not support removing enum values directly.
