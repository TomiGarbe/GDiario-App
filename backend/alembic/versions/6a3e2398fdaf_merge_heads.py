"""merge heads

Revision ID: 6a3e2398fdaf
Revises: aa17e5b8d1f2, d2f4a8c9b731
Create Date: 2026-07-27 16:39:36.788904

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6a3e2398fdaf'
down_revision: Union[str, Sequence[str], None] = ('aa17e5b8d1f2', 'd2f4a8c9b731')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
