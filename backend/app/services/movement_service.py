from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import logging
from types import SimpleNamespace
import unicodedata
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
    test_sheets,
)
from app.services.name_resolver import normalize_entity_name, resolve_or_create_entities
from app.models.sheet_sync_job import SheetSyncAction
from app.services.sheet_sync_service import SheetSyncService
from app.services.validation_service import ValidationService

TWOPLACES = Decimal("0.0001")
logger = logging.getLogger(__name__)


class MovementNotFoundError(Exception):
    pass


class MovementService:
    @staticmethod
    def _is_product_sheet_supported(product_name: str | None) -> bool:
        text = str(product_name or "").strip().lower()
        normalized = "".join(
            char
            for char in unicodedata.normalize("NFKD", text)
            if not unicodedata.combining(char)
        )
        if normalized == "grasa":
            return True
        if "hueso" in normalized:
            return True
        if "aserrin" in normalized:
            return True
        return False

    @staticmethod
    def _resolve_source(movement_type: MovementType) -> str:
        if movement_type == MovementType.ENTREGA_DINERO:
            return "app-entrega"
        return "app"

    @staticmethod
    def _extract_product_cells(movement: Movement) -> set[tuple]:
        cells: set[tuple] = set()
        for item in movement.items or []:
            product_name = str(item.product.name or "").strip()
            if not MovementService._is_product_sheet_supported(product_name):
                continue
            cells.add((movement.date, item.client.name, product_name))
        return cells

    @staticmethod
    def _validate_no_duplicate_client_movement(
        db: Session,
        movement_type: MovementType,
        data: MovementCreate,
    ) -> None:
        if movement_type not in (MovementType.COMPRA, MovementType.VENTA):
            return

        normalized_items = []

        for item in (data.items or []):
            client = str(item.client or "").strip().lower()
            product = str(item.product or "").strip().lower()

            if not client:
                continue

            normalized_items.append({
                "client": client,
                "product": product,
            })

        # evitar validar duplicados repetidos dentro del mismo request
        unique_items = {
            (
                item["client"],
                item["product"] if movement_type == MovementType.VENTA else None,
            )
            for item in normalized_items
        }

        for client, product in unique_items:
            query = (
                select(Movement)
                .join(MovementItem, MovementItem.movement_id == Movement.id)
                .join(Client, Client.id == MovementItem.client_id)
                .where(
                    Movement.deleted_at.is_(None),
                    Movement.date == data.date,
                    Movement.type == movement_type,
                    func.lower(func.trim(Client.name)) == client,
                )
            )

            # SOLO ventas validan producto
            if movement_type == MovementType.VENTA:
                query = query.join(Product, Product.id == MovementItem.product_id).where(
                    func.lower(func.trim(Product.name)) == product
                )

            existing = db.scalar(
                query.order_by(Movement.created_at.asc()).limit(1)
            )

            if existing is not None:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "MOVEMENT_ALREADY_EXISTS",
                        "client": client,
                        "product": product if movement_type == MovementType.VENTA else None,
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
            source=MovementService._resolve_source(movement_type),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(movement)
        db.flush()

        MovementService.replace_details(db, movement.id, movement_type, items, salaries, client_payments)
        db.flush()
        db.expire(movement, ["items", "salaries", "client_payments"])
        movement = MovementService.get_movement_by_id(db, movement.id)

        sheet_id = MovementService._get_sheet_id_for_period_id(db, movement.period_id)
        if sheet_id:
            SheetSyncService.enqueue(
                db,
                movement=movement,
                sheet_id=sheet_id,
                action=SheetSyncAction.CREATE,
            )
        # The movement and its durable outbox row commit atomically.  Sheets is
        # deliberately not contacted on this request.
        db.commit()

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
        movement = db.scalar(
            select(Movement)
            .where(Movement.id == movement_id, Movement.deleted_at.is_(None))
            .options(
                selectinload(Movement.items).selectinload(MovementItem.client),
                selectinload(Movement.items).selectinload(MovementItem.product),
            )
        )
        if movement is None:
            raise MovementNotFoundError(f"Movement with id '{movement_id}' was not found")
        previous_period_id = movement.period_id
        previous_product_cells = MovementService._extract_product_cells(movement)

        movement_type = MovementType(data.type)
        items, salaries, client_payments, amount = MovementService._prepare_payload(db, movement_type, data)

        movement.period_id = data.period_id
        movement.date = data.date
        movement.type = movement_type
        movement.amount = amount
        movement.description = data.description
        movement.source = MovementService._resolve_source(movement_type)
        movement.updated_at = datetime.now(timezone.utc)
        movement.deleted_at = None

        MovementService.replace_details(db, movement.id, movement_type, items, salaries, client_payments)
        db.flush()
        db.expire(movement, ["items", "salaries", "client_payments"])
        movement = MovementService.get_movement_by_id(db, movement.id)

        previous_sheet_id = MovementService._get_sheet_id_for_period_id(db, previous_period_id)
        new_sheet_id = MovementService._get_sheet_id_for_period_id(db, movement.period_id)
        if previous_sheet_id and previous_sheet_id != new_sheet_id:
            SheetSyncService.enqueue(
                db,
                movement=movement,
                period_id=previous_period_id,
                sheet_id=previous_sheet_id,
                action=SheetSyncAction.DELETE,
                payload={
                    "previous_product_cells": MovementService._serialize_product_cells(previous_product_cells),
                    "recalculate_period_id": previous_period_id,
                },
            )
        if new_sheet_id:
            SheetSyncService.enqueue(
                db,
                movement=movement,
                sheet_id=new_sheet_id,
                action=SheetSyncAction.UPDATE,
                payload={
                    "previous_product_cells": MovementService._serialize_product_cells(previous_product_cells)
                    if previous_sheet_id == new_sheet_id
                    else [],
                },
            )
        db.commit()

        return movement

    @staticmethod
    def delete_movement(db: Session, movement_id: UUID) -> None:
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
        product_cells = MovementService._extract_product_cells(movement)
        period_id = movement.period_id
        movement.deleted_at = datetime.now(timezone.utc)
        movement.updated_at = movement.deleted_at
        movement.source = MovementService._resolve_source(movement.type)
        sheet_id = MovementService._get_sheet_id_for_period_id(db, period_id)
        if sheet_id:
            SheetSyncService.enqueue(
                db,
                movement=movement,
                period_id=period_id,
                sheet_id=sheet_id,
                action=SheetSyncAction.DELETE,
                payload={
                    "previous_product_cells": MovementService._serialize_product_cells(product_cells),
                    "recalculate_period_id": period_id,
                },
            )
        db.commit()

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
        elif movement_type in (MovementType.SUELDO, MovementType.SALDO_INICIAL):
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
        elif movement_type in (MovementType.SUELDO, MovementType.SALDO_INICIAL):
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
        debe_types = ("compra", "gasto", "sueldo", "saldo_inicial")
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

    @staticmethod
    def _serialize_product_cells(cells: set[tuple] | None) -> list[list[str]]:
        out: list[list[str]] = []
        for movement_date, client_name, product_name in cells or set():
            out.append([str(movement_date), str(client_name), str(product_name)])
        return out
