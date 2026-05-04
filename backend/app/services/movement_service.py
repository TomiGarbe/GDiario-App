from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import logging
from types import SimpleNamespace
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.client import Client
from app.models.employee import Employee
from app.models.movement import Movement, MovementType
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem
from app.models.movement_salary import MovementSalary
from app.models.period import Period
from app.models.product import Product
from app.schemas.movement import MovementCreate, MovementUpdate
from app.services.google_sheets_writer import (
    delete_movement_from_sheets,
    sync_movement_to_sheets,
    test_sheets,
    update_movement_sheets,
)
from app.services.name_resolver import normalize_entity_name, resolve_or_create_entities
from app.services.validation_service import ValidationService

TWOPLACES = Decimal("0.0001")
logger = logging.getLogger(__name__)


class MovementNotFoundError(Exception):
    pass


class MovementService:
    @staticmethod
    def _validate_no_duplicate_client_movement(
        db: Session,
        movement_type: MovementType,
        data: MovementCreate,
    ) -> None:
        if movement_type not in (MovementType.COMPRA, MovementType.VENTA):
            return

        clients = {
            (str(item.client or "").strip().lower())
            for item in (data.items or [])
            if str(item.client or "").strip()
        }

        for client in clients:
            existing = db.scalar(
                select(Movement)
                .join(MovementItem, MovementItem.movement_id == Movement.id)
                .join(Client, Client.id == MovementItem.client_id)
                .where(
                    Movement.deleted_at.is_(None),
                    Movement.date == data.date,
                    Movement.type == movement_type,
                    func.lower(func.trim(Client.name)) == client,
                )
                .order_by(Movement.created_at.asc())
                .limit(1)
            )

            if existing is not None:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "MOVEMENT_ALREADY_EXISTS",
                        "client": client,
                        "movement_id": str(existing.id),
                    },
                )

    @staticmethod
    def get_movement_by_id(db: Session, movement_id: UUID) -> Movement:
        movement = db.scalar(
            select(Movement)
            .where(Movement.id == movement_id, Movement.deleted_at.is_(None))
            .options(
                selectinload(Movement.items).selectinload(MovementItem.client),
                selectinload(Movement.items).selectinload(MovementItem.product),
                selectinload(Movement.salaries).selectinload(MovementSalary.employee),
                selectinload(Movement.client_payments).selectinload(MovementClientPayment.client),
            )
        )
        if movement is None:
            raise MovementNotFoundError(f"Movement with id '{movement_id}' was not found")
        return movement

    @staticmethod
    def create_movement(db: Session, data: MovementCreate) -> Movement:
        movement_type = MovementType(data.type)
        MovementService._validate_no_duplicate_client_movement(db, movement_type, data)
        items, salaries, client_payments, amount = MovementService._prepare_payload(db, movement_type, data)

        movement = Movement(
            period_id=data.period_id,
            date=data.date,
            type=movement_type,
            amount=amount,
            description=data.description,
            source="app",
            updated_at=datetime.now(timezone.utc),
        )
        db.add(movement)
        db.flush()

        MovementService.replace_details(db, movement.id, movement_type, items, salaries, client_payments)
        db.commit()
        movement = MovementService.get_movement_by_id(db, movement.id)

        sheet_id = MovementService._get_sheet_id_for_period_id(db, movement.period_id)
        if sheet_id:
            try:
                sync_movement_to_sheets(sheet_id, movement)
            except Exception:
                logger.exception(
                    "Failed to append movement to Google Sheets. movement_id=%s period_id=%s",
                    movement.id,
                    movement.period_id,
                )

        return movement

    @staticmethod
    def test_sheets_for_period(db: Session, period_id: int) -> str:
        sheet_id = MovementService._get_sheet_id_for_period_id(db, period_id)
        if not sheet_id:
            return f"ERROR: period_id={period_id} has no sheet_id"
        test_sheets(sheet_id)
        return f"OK: test_sheets executed for period_id={period_id} sheet_id={sheet_id}"

    @staticmethod
    def update_movement(db: Session, movement_id: UUID, data: MovementUpdate) -> Movement:
        movement = db.scalar(select(Movement).where(Movement.id == movement_id, Movement.deleted_at.is_(None)))
        if movement is None:
            raise MovementNotFoundError(f"Movement with id '{movement_id}' was not found")
        previous_period_id = movement.period_id

        movement_type = MovementType(data.type)
        items, salaries, client_payments, amount = MovementService._prepare_payload(db, movement_type, data)

        movement.period_id = data.period_id
        movement.date = data.date
        movement.type = movement_type
        movement.amount = amount
        movement.description = data.description
        movement.source = "app"
        movement.updated_at = datetime.now(timezone.utc)
        movement.deleted_at = None

        MovementService.replace_details(db, movement.id, movement_type, items, salaries, client_payments)
        db.commit()
        movement = MovementService.get_movement_by_id(db, movement.id)

        previous_sheet_id = MovementService._get_sheet_id_for_period_id(db, previous_period_id)
        new_sheet_id = MovementService._get_sheet_id_for_period_id(db, movement.period_id)
        if previous_sheet_id and previous_sheet_id != new_sheet_id:
            try:
                delete_movement_from_sheets(previous_sheet_id, str(movement.id))
            except Exception:
                logger.exception(
                    "Failed to delete movement from previous Google Sheet on update. movement_id=%s period_id=%s",
                    movement.id,
                    previous_period_id,
                )
        if new_sheet_id:
            try:
                update_movement_sheets(new_sheet_id, movement)
            except Exception:
                logger.exception(
                    "Failed to update movement in Google Sheets. movement_id=%s period_id=%s",
                    movement.id,
                    movement.period_id,
                )

        return movement

    @staticmethod
    def delete_movement(db: Session, movement_id: UUID) -> None:
        movement = db.scalar(select(Movement).where(Movement.id == movement_id, Movement.deleted_at.is_(None)))
        if movement is None:
            raise MovementNotFoundError(f"Movement with id '{movement_id}' was not found")
        period_id = movement.period_id
        movement.deleted_at = datetime.now(timezone.utc)
        movement.updated_at = movement.deleted_at
        movement.source = "app"
        db.commit()

        sheet_id = MovementService._get_sheet_id_for_period_id(db, period_id)
        if sheet_id:
            try:
                delete_movement_from_sheets(sheet_id, str(movement_id))
            except Exception:
                logger.exception(
                    "Failed to delete movement from Google Sheets. movement_id=%s period_id=%s",
                    movement_id,
                    period_id,
                )

    @staticmethod
    def replace_details(
        db: Session,
        movement_id: UUID,
        movement_type: MovementType,
        items: list[dict],
        salaries: list[dict],
        client_payments: list[dict],
    ) -> None:
        db.query(MovementItem).filter(MovementItem.movement_id == movement_id).delete()
        db.query(MovementSalary).filter(MovementSalary.movement_id == movement_id).delete()
        db.query(MovementClientPayment).filter(MovementClientPayment.movement_id == movement_id).delete()

        if movement_type in (MovementType.COMPRA, MovementType.VENTA):
            for item in items:
                db.add(MovementItem(movement_id=movement_id, **item))
        elif movement_type == MovementType.SUELDO:
            for salary in salaries:
                db.add(MovementSalary(movement_id=movement_id, **salary))
        elif movement_type == MovementType.PAGO_CLIENTE:
            for client_payment in client_payments:
                db.add(MovementClientPayment(movement_id=movement_id, **client_payment))

    @staticmethod
    def _prepare_payload(
        db: Session,
        movement_type: MovementType,
        data: MovementCreate | MovementUpdate,
    ) -> tuple[list[dict], list[dict], list[dict], Decimal]:
        item_payload = data.items or []
        salary_payload = data.salaries or []
        client_payment_payload = data.client_payments or []

        ValidationService.validate_unified_movement_payload(
            movement_type=movement_type,
            amount=data.amount,
            items=item_payload,
            salaries=salary_payload,
            client_payments=client_payment_payload,
        )

        client_map = resolve_or_create_entities(
            db,
            Client,
            [item.client for item in item_payload] + [cp.client for cp in client_payment_payload],
        )
        product_map = resolve_or_create_entities(db, Product, [item.product for item in item_payload])
        employee_map = resolve_or_create_entities(db, Employee, [salary.employee for salary in salary_payload])

        items: list[dict] = []
        for item in item_payload:
            subtotal = item.subtotal if item.subtotal is not None else (item.quantity * item.unit_price)
            ValidationService.validate_item_fields(
                SimpleNamespace(quantity=item.quantity, unit_price=item.unit_price, subtotal=subtotal)
            )
            items.append(
                {
                    "client_id": client_map[normalize_entity_name(item.client)],
                    "product_id": product_map[normalize_entity_name(item.product)],
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "subtotal": subtotal.quantize(TWOPLACES),
                }
            )

        salaries: list[dict] = []
        for salary in salary_payload:
            ValidationService.validate_salary_fields(salary)
            salaries.append(
                {
                    "employee_id": employee_map[normalize_entity_name(salary.employee)],
                    "subtotal": salary.subtotal.quantize(TWOPLACES),
                }
            )

        client_payments: list[dict] = []
        for client_payment in client_payment_payload:
            ValidationService.validate_client_payment_fields(client_payment)
            client_payments.append(
                {
                    "client_id": client_map[normalize_entity_name(client_payment.client)],
                    "subtotal": client_payment.subtotal.quantize(TWOPLACES),
                }
            )

        if movement_type in (MovementType.COMPRA, MovementType.VENTA):
            amount = sum((item["subtotal"] for item in items), Decimal("0")).quantize(TWOPLACES)
        elif movement_type == MovementType.SUELDO:
            amount = sum((salary["subtotal"] for salary in salaries), Decimal("0")).quantize(TWOPLACES)
        elif movement_type == MovementType.PAGO_CLIENTE:
            amount = sum((cp["subtotal"] for cp in client_payments), Decimal("0")).quantize(TWOPLACES)
        else:
            amount = data.amount.quantize(TWOPLACES)

        ValidationService.validate_amount_consistency(
            SimpleNamespace(id=None, type=movement_type.value, amount=amount),
            [SimpleNamespace(**item) for item in items],
            [SimpleNamespace(**salary) for salary in salaries],
            [SimpleNamespace(**cp) for cp in client_payments],
        )

        return items, salaries, client_payments, amount

    @staticmethod
    def get_balance_until_date(db: Session, target_date) -> tuple[Decimal, Decimal, Decimal]:
        debe_types = ("compra", "gasto", "sueldo")
        haber_types = ("venta", "pago_cliente")

        total_debe = (
            db.query(func.coalesce(func.sum(Movement.amount), 0))
            .filter(Movement.date <= target_date, Movement.type.in_(debe_types))
            .filter(Movement.deleted_at.is_(None))
            .scalar()
        )
        total_haber = (
            db.query(func.coalesce(func.sum(Movement.amount), 0))
            .filter(Movement.date <= target_date, Movement.type.in_(haber_types))
            .filter(Movement.deleted_at.is_(None))
            .scalar()
        )

        total_debe_dec = Decimal(total_debe).quantize(TWOPLACES)
        total_haber_dec = Decimal(total_haber).quantize(TWOPLACES)
        balance = (total_haber_dec - total_debe_dec).quantize(TWOPLACES)
        return total_debe_dec, total_haber_dec, balance

    @staticmethod
    def _get_sheet_id_for_period_id(db: Session, period_id: int) -> str | None:
        year = period_id // 100
        month = period_id % 100
        period = db.scalar(
            select(Period).where(
                Period.year == year,
                Period.month == month,
            )
        )
        if period is None:
            return None
        return (period.sheet_id or "").strip() or None
