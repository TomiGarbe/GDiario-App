from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.movement import Movement
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem
from app.models.movement_salary import MovementSalary


class MovementRepository:
    @staticmethod
    def existing_movement_ids(session: Session, movement_ids: Iterable[UUID]) -> set[UUID]:
        ids = list(set(movement_ids))
        if not ids:
            return set()

        rows = session.execute(select(Movement.id).where(Movement.id.in_(ids))).scalars().all()
        return set(rows)

    @staticmethod
    def upsert_movements(session: Session, rows: list[dict]) -> tuple[int, int]:
        if not rows:
            return 0, 0

        ids = [row["id"] for row in rows]
        existing_ids = MovementRepository.existing_movement_ids(session, ids)

        stmt = pg_insert(Movement).values(rows)
        session.execute(
            stmt.on_conflict_do_update(
                index_elements=[Movement.id],
                set_={
                    "period_id": stmt.excluded.period_id,
                    "date": stmt.excluded.date,
                    "type": stmt.excluded.type,
                    "amount": stmt.excluded.amount,
                    "description": stmt.excluded.description,
                },
            )
        )

        updated = sum(1 for row in rows if row["id"] in existing_ids)
        inserted = len(rows) - updated
        return inserted, updated

    @staticmethod
    def replace_movement_items(session: Session, movement_ids: set[UUID], rows: list[dict]) -> tuple[int, int]:
        deleted = 0
        if movement_ids:
            deleted = (
                session.execute(
                    delete(MovementItem).where(MovementItem.movement_id.in_(movement_ids))
                )
                .rowcount
                or 0
            )

        if rows:
            session.execute(pg_insert(MovementItem).values(rows))

        return deleted, len(rows)

    @staticmethod
    def replace_movement_salaries(session: Session, movement_ids: set[UUID], rows: list[dict]) -> tuple[int, int]:
        deleted = 0
        if movement_ids:
            deleted = (
                session.execute(
                    delete(MovementSalary).where(MovementSalary.movement_id.in_(movement_ids))
                )
                .rowcount
                or 0
            )

        if rows:
            session.execute(pg_insert(MovementSalary).values(rows))

        return deleted, len(rows)

    @staticmethod
    def replace_movement_client_payments(session: Session, movement_ids: set[UUID], rows: list[dict]) -> tuple[int, int]:
        deleted = 0
        if movement_ids:
            deleted = (
                session.execute(
                    delete(MovementClientPayment).where(MovementClientPayment.movement_id.in_(movement_ids))
                )
                .rowcount
                or 0
            )

        if rows:
            session.execute(pg_insert(MovementClientPayment).values(rows))

        return deleted, len(rows)
