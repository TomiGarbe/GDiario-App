"""Explicit PostgreSQL-to-Sheets export payloads.

Google Apps Script invokes this service only when the user selects
"Actualizar Google Sheets". The Add-on applies the returned snapshot to the
open spreadsheet; normal App requests never call this service or Google APIs.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.movement import Movement, MovementType
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem
from app.models.movement_salary import MovementSalary

logger = logging.getLogger(__name__)


class ExportService:
    @staticmethod
    def export_full(db: Session, period_id: int) -> dict:
        """Build the complete authoritative snapshot for one Sheet period."""
        movements = (
            db.execute(
                select(Movement)
                .options(
                    selectinload(Movement.items).selectinload(MovementItem.client),
                    selectinload(Movement.items).selectinload(MovementItem.product),
                    selectinload(Movement.salaries).selectinload(MovementSalary.employee),
                    selectinload(Movement.client_payments).selectinload(MovementClientPayment.client),
                )
                .where(Movement.period_id == period_id, Movement.deleted_at.is_(None))
                .order_by(Movement.date.asc(), Movement.created_at.asc(), Movement.id.asc())
            )
            .scalars()
            .all()
        )

        movement_rows = []
        movement_item_rows = []
        movement_salary_rows = []
        movement_client_payment_rows = []

        for movement in movements:
            movement_rows.append(
                {
                    "id": movement.id,
                    "period_id": movement.period_id,
                    "date": movement.date,
                    "type": movement.type.value if isinstance(movement.type, MovementType) else str(movement.type),
                    "amount": movement.amount,
                    "description": movement.description,
                    "updated_at": movement.updated_at,
                    "source": movement.source,
                    "deleted_at": movement.deleted_at,
                }
            )
            movement_item_rows.extend(
                {
                    "id": item.id,
                    "movement_id": item.movement_id,
                    "client_name": item.client.name,
                    "product_name": item.product.name,
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "subtotal": item.subtotal,
                }
                for item in movement.items
            )
            movement_salary_rows.extend(
                {
                    "id": salary.id,
                    "movement_id": salary.movement_id,
                    "employee_name": salary.employee.name,
                    "subtotal": salary.subtotal,
                }
                for salary in movement.salaries
            )
            for payment in movement.client_payments:
                payment_payload = {
                    "id": payment.id,
                    "movement_id": payment.movement_id,
                    "client_name": payment.client.name,
                    "subtotal": payment.subtotal,
                }
                logger.info(
                    "CustomerPayment export payment_id=%s amount_db=%s amount_payload=%s",
                    payment.id,
                    payment.subtotal,
                    payment_payload["subtotal"],
                )
                movement_client_payment_rows.append(payment_payload)

        return {
            "schema_version": "v2",
            "movements": movement_rows,
            "movement_items": movement_item_rows,
            "movement_salaries": movement_salary_rows,
            "movement_client_payments": movement_client_payment_rows,
        }
