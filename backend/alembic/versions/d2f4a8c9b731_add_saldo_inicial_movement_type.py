"""add saldo inicial movement type

Revision ID: d2f4a8c9b731
Revises: 9a7d4b2e6c31
Create Date: 2026-07-07 00:00:00

"""
from typing import Sequence, Union

from alembic import op


revision: str = "d2f4a8c9b731"
down_revision: Union[str, Sequence[str], None] = "9a7d4b2e6c31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'SALDO_INICIAL'")


def downgrade() -> None:
    # PostgreSQL cannot drop enum values without rebuilding the enum type.
    pass
