"""restore client-payment subtotals incorrectly zeroed during sync

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
"""
from alembic import op


revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Restore only unambiguous one-client payments from their movement total."""
    op.execute(
        """
        WITH single_client_payment AS (
            SELECT movement_id
            FROM movement_client_payments
            GROUP BY movement_id
            HAVING COUNT(*) = 1
        )
        UPDATE movement_client_payments AS payment
        SET subtotal = movement.amount
        FROM movements AS movement
        JOIN single_client_payment AS single ON single.movement_id = movement.id
        WHERE payment.movement_id = movement.id
          AND movement.type = 'PAGO_CLIENTE'::movement_type
          AND payment.subtotal = 0
          AND movement.amount <> 0
        """
    )


def downgrade() -> None:
    # This is a data repair: the previous zero values were invalid and cannot
    # be safely reconstructed from the corrected database.
    pass
