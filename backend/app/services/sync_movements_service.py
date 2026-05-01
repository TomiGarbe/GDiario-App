from __future__ import annotations

from uuid import uuid4

from sqlalchemy import insert
from sqlalchemy.orm import Session

from app.models.movement import Movement
from app.models.movement_detail import MovementDetail


class SyncMovementsService:
    @staticmethod
    def sync_movements(db: Session, items: list) -> tuple[int, int]:
        if not items:
            db.commit()
            return 0, 0

        movement_rows: list[dict] = []
        detail_rows: list[dict] = []

        dedup_keys: set[tuple] = set()
        for item in items:
            dedup_key = (
                item.period_id,
                item.date,
                item.type,
                item.client_id,
                item.employee_id,
                item.amount,
                item.description,
                item.sheet_id,
                item.sheet_tab,
                item.row_number,
            )
            if dedup_key in dedup_keys:
                continue
            dedup_keys.add(dedup_key)

            movement_id = uuid4()
            movement_rows.append(
                {
                    "id": movement_id,
                    "period_id": item.period_id,
                    "date": item.date,
                    "type": item.type,
                    "client_id": item.client_id,
                    "employee_id": item.employee_id,
                    "amount": item.amount,
                    "description": item.description,
                    "source": "sheet",
                    "sheet_id": item.sheet_id,
                    "sheet_tab": item.sheet_tab,
                    "row_number": item.row_number,
                }
            )

            for detail in item.details:
                detail_rows.append(
                    {
                        "id": uuid4(),
                        "movement_id": movement_id,
                        "type": detail.type,
                        "product_id": detail.product_id,
                        "employee_id": detail.employee_id,
                        "quantity": detail.quantity,
                        "unit_price": detail.unit_price,
                        "subtotal": detail.subtotal,
                    }
                )

        if movement_rows:
            db.execute(insert(Movement), movement_rows)
        if detail_rows:
            db.execute(insert(MovementDetail), detail_rows)

        db.commit()
        return len(items), len(movement_rows)
