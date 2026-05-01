"""add entrega_dinero to movement_type enum

Revision ID: 2d7f3c1a9b10
Revises: c1a2b3d4e5f6
Create Date: 2026-05-01 17:05:00
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "2d7f3c1a9b10"
down_revision = "c1a2b3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'entrega_dinero'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values directly.
    # Kept as no-op to preserve migration chain safety.
    pass
