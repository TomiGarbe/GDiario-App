"""add movement mirror fields

Revision ID: 5f2b8e8e9c11
Revises: 760c28f713f8
Create Date: 2026-05-03 00:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5f2b8e8e9c11'
down_revision: Union[str, Sequence[str], None] = '760c28f713f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('movements', sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False))
    op.add_column('movements', sa.Column('source', sa.Text(), server_default=sa.text("'app'"), nullable=False))
    op.add_column('movements', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    op.create_index(op.f('ix_movements_updated_at'), 'movements', ['updated_at'], unique=False)
    op.create_index(op.f('ix_movements_deleted_at'), 'movements', ['deleted_at'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_movements_deleted_at'), table_name='movements')
    op.drop_index(op.f('ix_movements_updated_at'), table_name='movements')
    op.drop_column('movements', 'deleted_at')
    op.drop_column('movements', 'source')
    op.drop_column('movements', 'updated_at')
