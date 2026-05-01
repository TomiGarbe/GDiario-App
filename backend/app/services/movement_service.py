from __future__ import annotations

import calendar
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.models.client import Client
from app.models.employee import Employee
from app.models.movement import Movement
from app.models.movement_detail import MovementDetail
from app.models.period import Period
from app.models.product import Product
from app.schemas.movement import MovementCreate

TWOPLACES = Decimal("0.01")


class MovementNotFoundError(Exception):
    pass


class InvalidMovementError(Exception):
    pass


class MovementService:
    @staticmethod
    def create_movement(db: Session, data: MovementCreate) -> Movement:
        client_cache: dict[str, Client] = {}
        employee_cache: dict[str, Employee] = {}
        product_cache: dict[str, Product] = {}

        try:
            period = MovementService._get_or_create_period_for_date(db, data.date)

            movement = Movement(
                period_id=period.id,
                date=data.date,
                type=data.type,
                amount=Decimal("0.00"),
                description=data.description,
                source="app",
            )

            if data.client:
                movement.client = MovementService._get_or_create_entity(db, Client, data.client, client_cache)

            if data.employee:
                movement.employee = MovementService._get_or_create_entity(db, Employee, data.employee, employee_cache)

            db.add(movement)
            db.flush()

            total_amount = Decimal("0.00")
            for detail_data in data.details:
                detail = MovementDetail(
                    movement_id=movement.id,
                    type=detail_data.type,
                    quantity=detail_data.quantity,
                    unit_price=detail_data.unit_price,
                    subtotal=None,
                )

                if detail_data.type == "producto":
                    if not detail_data.product:
                        raise InvalidMovementError("detail.product is required when detail.type='producto'")
                    detail.product = MovementService._get_or_create_entity(
                        db,
                        Product,
                        detail_data.product,
                        product_cache,
                    )

                if detail_data.type == "empleado":
                    employee_name = detail_data.employee or data.employee
                    if not employee_name:
                        raise InvalidMovementError(
                            "detail.employee or movement.employee is required when detail.type='empleado'"
                        )
                    detail.employee = MovementService._get_or_create_entity(
                        db,
                        Employee,
                        employee_name,
                        employee_cache,
                    )

                detail.subtotal = MovementService._calculate_subtotal(detail.quantity, detail.unit_price)
                if detail.subtotal is not None:
                    total_amount += detail.subtotal

                db.add(detail)

            movement.amount = total_amount.quantize(TWOPLACES)
            db.commit()
        except Exception:
            db.rollback()
            raise

        return MovementService.get_movement_by_id(db, movement.id)

    @staticmethod
    def get_movements(db: Session) -> list[Movement]:
        return (
            db.query(Movement)
            .options(
                joinedload(Movement.client),
                joinedload(Movement.employee),
                joinedload(Movement.details).joinedload(MovementDetail.product),
                joinedload(Movement.details).joinedload(MovementDetail.employee),
            )
            .order_by(Movement.date.desc())
            .all()
        )

    @staticmethod
    def get_movement_by_id(db: Session, movement_id: UUID) -> Movement:
        movement = (
            db.query(Movement)
            .options(
                joinedload(Movement.client),
                joinedload(Movement.employee),
                joinedload(Movement.details).joinedload(MovementDetail.product),
                joinedload(Movement.details).joinedload(MovementDetail.employee),
            )
            .filter(Movement.id == movement_id)
            .first()
        )
        if movement is None:
            raise MovementNotFoundError(f"Movement with id '{movement_id}' was not found")
        return movement

    @staticmethod
    def delete_movement(db: Session, movement_id: UUID) -> None:
        movement = db.get(Movement, movement_id)
        if movement is None:
            raise MovementNotFoundError(f"Movement with id '{movement_id}' was not found")

        try:
            db.delete(movement)
            db.commit()
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def _calculate_subtotal(quantity: Decimal | None, unit_price: Decimal | None) -> Decimal | None:
        if quantity is None or unit_price is None:
            return None
        return (quantity * unit_price).quantize(TWOPLACES)

    @staticmethod
    def _get_or_create_period_for_date(db: Session, movement_date: date) -> Period:
        period = (
            db.query(Period)
            .filter(
                Period.year == movement_date.year,
                Period.month == movement_date.month,
            )
            .first()
        )
        if period is not None:
            return period

        last_day = calendar.monthrange(movement_date.year, movement_date.month)[1]
        period = Period(
            year=movement_date.year,
            month=movement_date.month,
            name=f"{movement_date.year}-{movement_date.month:02d}",
            start_date=date(movement_date.year, movement_date.month, 1),
            end_date=date(movement_date.year, movement_date.month, last_day),
        )
        db.add(period)
        db.flush()
        return period

    @staticmethod
    def _normalize_name(name: str) -> str:
        return " ".join(name.strip().split()).lower()

    @staticmethod
    def _get_or_create_entity(
        db: Session,
        model: type[Client] | type[Employee] | type[Product],
        raw_name: str,
        cache: dict[str, Client | Employee | Product],
    ) -> Client | Employee | Product:
        normalized_name = MovementService._normalize_name(raw_name)
        if normalized_name in cache:
            return cache[normalized_name]

        existing = db.query(model).filter(func.lower(model.name) == normalized_name).first()
        if existing is not None:
            cache[normalized_name] = existing
            return existing

        entity = model(name=" ".join(raw_name.strip().split()))
        db.add(entity)
        db.flush()
        cache[normalized_name] = entity
        return entity
