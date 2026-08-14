from __future__ import annotations

import logging
from collections.abc import Iterable
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session, selectinload

from app.models.period import Period
from app.models.price import Price
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem
from app.models.movement_salary import MovementSalary
from app.models.client import Client
from app.models.employee import Employee
from app.models.movement import Movement
from app.models.movement import MovementType
from app.models.product import Product
from app.repositories.movement_repository import MovementRepository
from app.services.name_resolver import normalize_entity_name, resolve_or_create_entities
from app.services.validation_service import ValidationService
from app.utils.business_rules import ZERO, coerce_zero_if_special_client, es_cliente_sin_monto


class SyncService:
    _logger = logging.getLogger(__name__)

    @staticmethod
    def ensure_clients(db: Session, names: Iterable[str]) -> tuple[int, int, int]:
        normalized_names = [normalize_entity_name(name) for name in names if str(name or "").strip()]
        if not normalized_names:
            return 0, 0, 0

        unique_names = list(dict.fromkeys(normalized_names))
        existing = set(db.execute(select(Client.name).where(Client.name.in_(unique_names))).scalars().all())
        missing = [name for name in unique_names if name not in existing]
        created = 0
        if missing:
            stmt = pg_insert(Client).values([{"name": name} for name in missing])
            result = db.execute(stmt.on_conflict_do_nothing(index_elements=[func.lower(Client.name)]))
            created = int(result.rowcount or 0)
        return len(normalized_names), created, len(unique_names) - created

    @staticmethod
    def ensure_products(db: Session, names: Iterable[str]) -> tuple[int, int, int]:
        normalized_names = [normalize_entity_name(name) for name in names if str(name or "").strip()]
        if not normalized_names:
            return 0, 0, 0

        unique_names = list(dict.fromkeys(normalized_names))
        existing = set(db.execute(select(Product.name).where(Product.name.in_(unique_names))).scalars().all())
        missing = [name for name in unique_names if name not in existing]
        created = 0
        if missing:
            stmt = pg_insert(Product).values([{"name": name} for name in missing])
            result = db.execute(stmt.on_conflict_do_nothing(index_elements=[func.lower(Product.name)]))
            created = int(result.rowcount or 0)
        return len(normalized_names), created, len(unique_names) - created

    @staticmethod
    def upsert_prices(db: Session, prices: Iterable) -> tuple[int, int]:
        price_list = list(prices)
        if not price_list:
            return 0, 0

        deduped: dict[tuple[str, str, date], object] = {}
        for row in price_list:
            client_name = normalize_entity_name(row.client_name)
            product_name = normalize_entity_name(row.product_name)
            key = (client_name, product_name, row.start_date)
            deduped[key] = row

        client_names = sorted({k[0] for k in deduped})
        product_names = sorted({k[1] for k in deduped})
        SyncService.ensure_clients(db, client_names)
        SyncService.ensure_products(db, product_names)

        client_map = SyncService._load_entity_map(db, Client)
        product_map = SyncService._load_entity_map(db, Product)
        missing_clients = sorted(name for name in client_names if name not in client_map)
        missing_products = sorted(name for name in product_names if name not in product_map)
        if missing_clients:
            raise ValueError(f"Clients not found: {', '.join(missing_clients)}")
        if missing_products:
            raise ValueError(f"Products not found: {', '.join(missing_products)}")

        rows = []
        for (client_name, product_name, start_date), item in deduped.items():
            if item.price is None or item.price < 0:
                raise ValueError("Invalid price")
            coerced_price, was_overridden = coerce_zero_if_special_client(client_name, item.price)
            if es_cliente_sin_monto(client_name):
                if was_overridden:
                    SyncService._logger.warning(
                        "Precio > 0 recibido para cliente sin monto. client=%s product=%s incoming=%s -> 0",
                        client_name,
                        product_name,
                        item.price,
                    )
            rows.append(
                {
                    "client_id": client_map[client_name],
                    "product_id": product_map[product_name],
                    "start_date": start_date,
                    "price": coerced_price,
                }
            )

        stmt = pg_insert(Price).values(rows)
        db.execute(
            stmt.on_conflict_do_update(
                constraint="uq_prices_client_product_start_date",
                set_={"price": stmt.excluded.price},
            )
        )
        return len(price_list), len(rows)

    @staticmethod
    def sync_catalog(db: Session, prices: Iterable) -> dict[str, int]:
        """Apply the PRECIOS snapshot as one catalog transaction."""
        price_list = list(prices)
        client_names = [item.client_name for item in price_list]
        product_names = [item.product_name for item in price_list]
        clients_received, clients_created, _ = SyncService.ensure_clients(db, client_names)
        products_received, products_created, _ = SyncService.ensure_products(db, product_names)
        prices_received, prices_upserted = SyncService.upsert_prices(db, price_list)

        return {
            "clients_received": clients_received,
            "clients_created": clients_created,
            "products_received": products_received,
            "products_created": products_created,
            "prices_received": prices_received,
            "prices_upserted": prices_upserted,
        }

    @staticmethod
    def sync_movements(db: Session, movements: Iterable) -> tuple[int, int, int]:
        movement_list = list(movements)
        if not movement_list:
            return 0, 0, 0

        ids = [item.id for item in movement_list]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate movement id in payload")
        for movement in movement_list:
            ValidationService.validate_movement_fields(movement)

        rows = [
            {
                "id": item.id,
                "period_id": item.period_id,
                "date": item.date,
                "type": MovementType(item.type),
                "amount": item.amount,
                "description": item.description,
                "updated_at": getattr(item, "updated_at", None) or datetime.now(timezone.utc),
                "source": getattr(item, "source", "sheet"),
                "deleted_at": None,
            }
            for item in movement_list
        ]

        inserted, updated = MovementRepository.upsert_movements(db, rows)
        return len(movement_list), inserted, updated

    @staticmethod
    def sync_movement_items(db: Session, items: Iterable) -> tuple[int, int, int]:
        item_list = list(items)
        if not item_list:
            return 0, 0, 0

        ids = [item.id for item in item_list]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate movement_item id in payload")

        movement_ids = {item.movement_id for item in item_list}
        existing_movement_ids = MovementRepository.existing_movement_ids(db, movement_ids)
        missing_movement_ids = movement_ids - existing_movement_ids
        if missing_movement_ids:
            raise ValueError("Movement not found")
        movement_types = SyncService._get_movement_types(db, movement_ids)
        for item in item_list:
            ValidationService.validate_item_fields(item)
            ValidationService.validate_detail_type_for_movement(movement_types[item.movement_id], "item")

        client_map = resolve_or_create_entities(db, Client, [item.client_name for item in item_list])
        product_map = resolve_or_create_entities(db, Product, [item.product_name for item in item_list])

        rows = [
            SyncService._build_sync_movement_item_row(
                item=item,
                client_id=client_map[normalize_entity_name(item.client_name)],
                product_id=product_map[normalize_entity_name(item.product_name)],
            )
            for item in item_list
        ]

        deleted, inserted = MovementRepository.replace_movement_items(db, movement_ids, rows)
        return len(item_list), inserted, deleted

    @staticmethod
    def sync_movement_salaries(db: Session, salaries: Iterable) -> tuple[int, int, int]:
        salary_list = list(salaries)
        if not salary_list:
            return 0, 0, 0

        ids = [item.id for item in salary_list]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate movement_salary id in payload")

        movement_ids = {item.movement_id for item in salary_list}
        existing_movement_ids = MovementRepository.existing_movement_ids(db, movement_ids)
        missing_movement_ids = movement_ids - existing_movement_ids
        if missing_movement_ids:
            raise ValueError("Movement not found")
        movement_types = SyncService._get_movement_types(db, movement_ids)
        for item in salary_list:
            ValidationService.validate_salary_fields(item)
            ValidationService.validate_detail_type_for_movement(movement_types[item.movement_id], "salary")

        employee_map = resolve_or_create_entities(db, Employee, [item.employee_name for item in salary_list])

        rows = [
            {
                "id": item.id,
                "movement_id": item.movement_id,
                "employee_id": employee_map[normalize_entity_name(item.employee_name)],
                "subtotal": item.subtotal,
            }
            for item in salary_list
        ]

        deleted, inserted = MovementRepository.replace_movement_salaries(db, movement_ids, rows)
        return len(salary_list), inserted, deleted

    @staticmethod
    def sync_movement_client_payments(db: Session, client_payments: Iterable) -> tuple[int, int, int]:
        client_payment_list = list(client_payments)
        if not client_payment_list:
            return 0, 0, 0

        ids = [item.id for item in client_payment_list]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate movement_client_payment id in payload")

        movement_ids = {item.movement_id for item in client_payment_list}
        existing_movement_ids = MovementRepository.existing_movement_ids(db, movement_ids)
        missing_movement_ids = movement_ids - existing_movement_ids
        if missing_movement_ids:
            raise ValueError("Movement not found")
        movement_types = SyncService._get_movement_types(db, movement_ids)
        for item in client_payment_list:
            ValidationService.validate_client_payment_fields(item)
            ValidationService.validate_detail_type_for_movement(movement_types[item.movement_id], "client_payment")

        client_map = resolve_or_create_entities(db, Client, [item.client_name for item in client_payment_list])

        rows = [
            SyncService._build_sync_movement_client_payment_row(
                item=item,
                client_id=client_map[normalize_entity_name(item.client_name)],
            )
            for item in client_payment_list
        ]

        deleted, inserted = MovementRepository.replace_movement_client_payments(db, movement_ids, rows)
        return len(client_payment_list), inserted, deleted

    @staticmethod
    def sync_full(db: Session, period, movements: Iterable, sheet_id: str, period_id: int) -> dict:
        if not str(sheet_id or "").strip():
            raise ValueError("sheet_id is required in sync/full")

        expected_period_id = period.year * 100 + period.month
        if period_id != expected_period_id:
            raise ValueError("period_id does not match period.year/month")

        period_id = SyncService._ensure_period_and_get_movement_period_id(db, period, sheet_id=sheet_id)
        movement_list = list(movements)
        if not movement_list:
            return {
                "period_id": period_id,
                "movements": {"received": 0, "inserted": 0, "updated": 0, "deleted": 0},
                "movement_items": {"received": 0, "inserted": 0, "updated": 0, "deleted": 0},
                "movement_salaries": {"received": 0, "inserted": 0, "updated": 0, "deleted": 0},
                "movement_client_payments": {"received": 0, "inserted": 0, "updated": 0, "deleted": 0},
            }

        movement_ids = [movement.external_id for movement in movement_list]
        if len(movement_ids) != len(set(movement_ids)):
            raise ValueError("Duplicate movement external_id in payload")

        conflicts = db.execute(
            select(Movement.id).where(
                Movement.id.in_(movement_ids),
                Movement.period_id != period_id,
                Movement.deleted_at.is_(None),
            )
        ).scalars().all()
        if conflicts:
            raise ValueError("Some movement external_id already exist in another period")

        movement_type_map = {movement.external_id: MovementType(movement.type) for movement in movement_list}
        for movement in movement_list:
            movement_type = movement_type_map[movement.external_id]
            if movement_type in (MovementType.COMPRA, MovementType.VENTA):
                if movement.salaries or movement.client_payments:
                    raise ValueError(f"Movement {movement.external_id} has invalid detail types for {movement_type.value}")
            elif movement_type in (MovementType.SUELDO, MovementType.SALDO_INICIAL):
                if movement.items or movement.client_payments:
                    raise ValueError(f"Movement {movement.external_id} has invalid detail types for {movement_type.value}")
            elif movement_type == MovementType.PAGO_CLIENTE:
                if movement.items or movement.salaries:
                    raise ValueError(f"Movement {movement.external_id} has invalid detail types for {movement_type.value}")
            else:
                if movement.items or movement.salaries or movement.client_payments:
                    raise ValueError(f"Movement {movement.external_id} cannot have detail rows")

            SyncService._validate_numeric_precision(movement.amount, 14, 4, "movement.amount")

        existing_in_period = set(
            db.execute(
                select(Movement.id).where(
                    Movement.id.in_(movement_ids),
                    Movement.period_id == period_id,
                    Movement.deleted_at.is_(None),
                )
            ).scalars().all()
        )

        now_utc = datetime.now(timezone.utc)
        movement_rows = [
            {
                "id": movement.external_id,
                "period_id": period_id,
                "date": movement.date,
                "type": movement_type_map[movement.external_id],
                "amount": SyncService._coerce_sync_full_movement_amount(movement),
                "description": movement.description,
                "updated_at": now_utc,
                "source": movement.source,
                "deleted_at": None,
            }
            for movement in movement_list
        ]
        stmt = pg_insert(Movement).values(movement_rows)
        db.execute(
            stmt.on_conflict_do_update(
                index_elements=[Movement.id],
                set_={
                    "period_id": stmt.excluded.period_id,
                    "date": stmt.excluded.date,
                    "type": stmt.excluded.type,
                    "amount": stmt.excluded.amount,
                    "description": stmt.excluded.description,
                    "updated_at": stmt.excluded.updated_at,
                    "source": stmt.excluded.source,
                    "deleted_at": stmt.excluded.deleted_at,
                },
            )
        )

        client_names = set()
        product_names = set()
        employee_names = set()
        total_items_received = 0
        total_salaries_received = 0
        total_client_payments_received = 0
        for movement in movement_list:
            total_items_received += len(movement.items)
            total_salaries_received += len(movement.salaries)
            total_client_payments_received += len(movement.client_payments)
            for item in movement.items:
                client_names.add(normalize_entity_name(item.client_name))
                product_names.add(normalize_entity_name(item.product_name))
                SyncService._validate_numeric_precision(item.quantity, 14, 4, "item.quantity")
                SyncService._validate_numeric_precision(item.unit_price, 14, 4, "item.unit_price")
                SyncService._validate_numeric_precision(item.subtotal, 14, 4, "item.subtotal")
            for salary in movement.salaries:
                employee_names.add(normalize_entity_name(salary.employee_name))
                SyncService._validate_numeric_precision(salary.subtotal, 14, 4, "salary.subtotal")
            for client_payment in movement.client_payments:
                client_names.add(normalize_entity_name(client_payment.client_name))
                SyncService._validate_numeric_precision(client_payment.subtotal, 14, 4, "client_payment.subtotal")

        client_map = SyncService._load_entity_map(db, Client)
        product_map = SyncService._load_entity_map(db, Product)
        employee_map = SyncService._load_entity_map(db, Employee)
        missing_clients = sorted(name for name in client_names if name not in client_map)
        missing_products = sorted(name for name in product_names if name not in product_map)
        missing_employees = sorted(name for name in employee_names if name not in employee_map)
        if missing_clients:
            raise ValueError(f"Clients not found: {', '.join(missing_clients)}")
        if missing_products:
            raise ValueError(f"Products not found: {', '.join(missing_products)}")
        if missing_employees:
            raise ValueError(f"Employees not found: {', '.join(missing_employees)}")

        item_rows = []
        salary_rows = []
        client_payment_rows = []
        for movement in movement_list:
            for item in movement.items:
                item_rows.append(
                    SyncService._build_sync_full_movement_item_row(
                        movement=movement,
                        item=item,
                        client_id=client_map[normalize_entity_name(item.client_name)],
                        product_id=product_map[normalize_entity_name(item.product_name)],
                    )
                )
            for salary in movement.salaries:
                salary_rows.append(
                    {
                        "movement_id": movement.external_id,
                        "employee_id": employee_map[normalize_entity_name(salary.employee_name)],
                        "subtotal": salary.subtotal,
                    }
                )
            for client_payment in movement.client_payments:
                client_payment_rows.append(
                    SyncService._build_sync_full_movement_client_payment_row(
                        movement=movement,
                        client_payment=client_payment,
                        client_id=client_map[normalize_entity_name(client_payment.client_name)],
                    )
                )

        deleted_items = db.execute(
            delete(MovementItem).where(MovementItem.movement_id.in_(movement_ids))
        ).rowcount or 0
        deleted_salaries = db.execute(
            delete(MovementSalary).where(MovementSalary.movement_id.in_(movement_ids))
        ).rowcount or 0
        deleted_client_payments = db.execute(
            delete(MovementClientPayment).where(MovementClientPayment.movement_id.in_(movement_ids))
        ).rowcount or 0

        if item_rows:
            db.execute(pg_insert(MovementItem).values(item_rows))
        if salary_rows:
            db.execute(pg_insert(MovementSalary).values(salary_rows))
        if client_payment_rows:
            db.execute(pg_insert(MovementClientPayment).values(client_payment_rows))

        existing_active_rows = db.execute(
            select(Movement.id, Movement.source).where(
                Movement.period_id == period_id,
                Movement.deleted_at.is_(None),
            )
        ).all()
        sheet_ids = set(movement_ids)
        db_ids = {movement_id for movement_id, source in existing_active_rows if source != "app-entrega"}
        to_delete = db_ids - sheet_ids
        print(f"[SYNC DELETE] {len(to_delete)} movements")
        for movement_id in to_delete:
            SyncService._soft_delete_movement_for_sync(db, movement_id, now_utc)

        inserted_movements = len([movement_id for movement_id in movement_ids if movement_id not in existing_in_period])
        updated_movements = len(movement_ids) - inserted_movements
        SyncService._logger.info(
            "sync_full period_id=%s movements=%s inserted=%s updated=%s items=%s salaries=%s client_payments=%s",
            period_id,
            len(movement_list),
            inserted_movements,
            updated_movements,
            len(item_rows),
            len(salary_rows),
            len(client_payment_rows),
        )
        return {
            "period_id": period_id,
            "movements": {
                "received": len(movement_list),
                "inserted": inserted_movements,
                "updated": updated_movements,
                "deleted": len(to_delete),
            },
            "movement_items": {
                "received": total_items_received,
                "inserted": len(item_rows),
                "updated": 0,
                "deleted": deleted_items,
            },
            "movement_salaries": {
                "received": total_salaries_received,
                "inserted": len(salary_rows),
                "updated": 0,
                "deleted": deleted_salaries,
            },
            "movement_client_payments": {
                "received": total_client_payments_received,
                "inserted": len(client_payment_rows),
                "updated": 0,
                "deleted": deleted_client_payments,
            },
        }

    @staticmethod
    def _ensure_period_and_get_movement_period_id(db: Session, period, sheet_id: str | None = None) -> int:
        record = db.execute(
            select(Period).where(Period.year == period.year, Period.month == period.month)
        ).scalar_one_or_none()
        clean_sheet_id = str(sheet_id or "").strip() or None
        if record is None:
            period_start = getattr(period, "start_date", None) or date(period.year, period.month, 1)
            if period.month == 12:
                period_end = date(period.year, 12, 31)
            else:
                next_month_start = date(period.year, period.month + 1, 1)
                period_end = date.fromordinal(next_month_start.toordinal() - 1)
            record = Period(
                year=period.year,
                month=period.month,
                name=getattr(period, "name", None) or f"{period.year:04d}-{period.month:02d}",
                sheet_id=clean_sheet_id,
                start_date=period_start,
                end_date=getattr(period, "end_date", None) or period_end,
            )
            db.add(record)
            db.flush()
        elif clean_sheet_id:
            record.sheet_id = clean_sheet_id
        period_id = period.year * 100 + period.month
        print(f"[SYNC] period_id={period_id}")
        return period_id

    @staticmethod
    def _validate_numeric_precision(value: Decimal, precision: int, scale: int, field_name: str) -> None:
        quantized = value.as_tuple()
        decimals = -quantized.exponent if quantized.exponent < 0 else 0
        digits = len(quantized.digits)
        integer_digits = digits - decimals
        if decimals > scale:
            raise ValueError(f"{field_name} has too many decimal places (max {scale})")
        if integer_digits > (precision - scale):
            raise ValueError(f"{field_name} exceeds numeric({precision},{scale})")

    @staticmethod
    def _load_entity_map(db: Session, model) -> dict[str, UUID]:
        rows = db.execute(select(model.id, model.name)).all()
        mapping: dict[str, UUID] = {}
        for entity_id, entity_name in rows:
            mapping[normalize_entity_name(entity_name)] = entity_id
        return mapping

    @staticmethod
    def _get_movement_types(db: Session, movement_ids: set[UUID]) -> dict[UUID, MovementType]:
        if not movement_ids:
            return {}
        rows = db.execute(
            select(Movement.id, Movement.type).where(
                Movement.id.in_(movement_ids),
                Movement.deleted_at.is_(None),
            )
        ).all()
        return {movement_id: movement_type for movement_id, movement_type in rows}

    @staticmethod
    def sync_mirror(db: Session, period, movements: Iterable, since: datetime | None = None) -> dict:
        period_id = SyncService._ensure_period_and_get_movement_period_id(db, period)
        movement_list = list(movements)
        sheet_ids = [movement.external_id for movement in movement_list]
        if len(sheet_ids) != len(set(sheet_ids)):
            raise ValueError("Duplicate movement external_id in payload")
        existing_rows = (
            db.execute(
                select(Movement)
                .options(
                    selectinload(Movement.items).selectinload(MovementItem.client),
                    selectinload(Movement.items).selectinload(MovementItem.product),
                    selectinload(Movement.salaries).selectinload(MovementSalary.employee),
                    selectinload(Movement.client_payments).selectinload(MovementClientPayment.client),
                )
                .where(Movement.period_id == period_id)
            )
            .scalars()
            .all()
        )
        sheet_map = {movement.external_id: movement for movement in movement_list}
        db_all_map = {movement.id: movement for movement in existing_rows}
        db_map = {movement.id: movement for movement in existing_rows if movement.deleted_at is None}

        inserted_count = 0
        updated_count = 0
        now_utc = datetime.now(timezone.utc)

        client_names = set()
        product_names = set()
        employee_names = set()
        for movement in movement_list:
            row_type = MovementType(movement.type)
            if row_type in (MovementType.COMPRA, MovementType.VENTA):
                if movement.salaries or movement.client_payments:
                    raise ValueError(f"Movement {movement.external_id} has invalid detail types for {row_type.value}")
            elif row_type in (MovementType.SUELDO, MovementType.SALDO_INICIAL):
                if movement.items or movement.client_payments:
                    raise ValueError(f"Movement {movement.external_id} has invalid detail types for {row_type.value}")
            elif row_type == MovementType.PAGO_CLIENTE:
                if movement.items or movement.salaries:
                    raise ValueError(f"Movement {movement.external_id} has invalid detail types for {row_type.value}")
            else:
                if movement.items or movement.salaries or movement.client_payments:
                    raise ValueError(f"Movement {movement.external_id} cannot have detail rows")

            for item in movement.items:
                client_names.add(normalize_entity_name(item.client_name))
                product_names.add(normalize_entity_name(item.product_name))
            for salary in movement.salaries:
                employee_names.add(normalize_entity_name(salary.employee_name))
            for client_payment in movement.client_payments:
                client_names.add(normalize_entity_name(client_payment.client_name))

        client_map = SyncService._load_entity_map(db, Client)
        product_map = SyncService._load_entity_map(db, Product)
        employee_map = SyncService._load_entity_map(db, Employee)
        missing_clients = sorted(name for name in client_names if name not in client_map)
        missing_products = sorted(name for name in product_names if name not in product_map)
        missing_employees = sorted(name for name in employee_names if name not in employee_map)
        if missing_clients:
            raise ValueError(f"Clients not found: {', '.join(missing_clients)}")
        if missing_products:
            raise ValueError(f"Products not found: {', '.join(missing_products)}")
        if missing_employees:
            raise ValueError(f"Employees not found: {', '.join(missing_employees)}")

        for movement_id, sheet_movement in sheet_map.items():
            db_movement = db_all_map.get(movement_id)
            sheet_snapshot = SyncService._build_sheet_snapshot(
                movement=sheet_movement,
                client_map=client_map,
                product_map=product_map,
                employee_map=employee_map,
            )

            if db_movement is None:
                new_movement = Movement(
                    id=movement_id,
                    period_id=period_id,
                    date=sheet_movement.date,
                    type=MovementType(sheet_movement.type),
                    amount=sheet_snapshot["amount"],
                    description=sheet_movement.description,
                    updated_at=sheet_movement.updated_at,
                    source=sheet_movement.source,
                    deleted_at=None,
                )
                db.add(new_movement)
                SyncService._replace_details_for_movement(
                    db,
                    movement_id,
                    item_rows=sheet_snapshot["item_rows"],
                    salary_rows=sheet_snapshot["salary_rows"],
                    client_payment_rows=sheet_snapshot["client_payment_rows"],
                )
                inserted_count += 1
                continue

            if db_movement.deleted_at is None and SyncService._movement_equals_sheet_snapshot(db_movement, sheet_snapshot):
                continue

            db_movement.period_id = period_id
            db_movement.date = sheet_movement.date
            db_movement.type = MovementType(sheet_movement.type)
            db_movement.amount = sheet_snapshot["amount"]
            db_movement.description = sheet_movement.description
            db_movement.updated_at = sheet_movement.updated_at
            db_movement.source = sheet_movement.source
            db_movement.deleted_at = None
            SyncService._replace_details_for_movement(
                db,
                movement_id,
                item_rows=sheet_snapshot["item_rows"],
                salary_rows=sheet_snapshot["salary_rows"],
                client_payment_rows=sheet_snapshot["client_payment_rows"],
            )
            updated_count += 1

        to_delete = {
            movement_id
            for movement_id, db_movement in db_map.items()
            if movement_id not in sheet_map and db_movement.source != "app-entrega"
        }
        print(f"[SYNC DELETE] {len(to_delete)} movements")
        for movement_id in to_delete:
            SyncService._soft_delete_movement_for_sync(db, movement_id, now_utc)
        deleted_count = len(to_delete)

        if since is None:
            db_changes = []
        else:
            db_changes = db.execute(
                select(Movement).where(
                    Movement.period_id == period_id,
                    Movement.updated_at > since,
                )
                .order_by(Movement.updated_at.asc(), Movement.id.asc())
            ).scalars().all()

        return {
            "period_id": period_id,
            "applied_from_sheet": {
                "received": len(movement_list),
                "inserted": inserted_count,
                "updated": updated_count,
                "deleted": deleted_count,
            },
            "db_changes_since_cursor": [
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
                for movement in db_changes
            ],
        }

    @staticmethod
    def _build_sheet_snapshot(
        *,
        movement,
        client_map: dict[str, UUID],
        product_map: dict[str, UUID],
        employee_map: dict[str, UUID],
    ) -> dict:
        item_rows = [
            SyncService._build_sync_full_movement_item_row(
                movement=movement,
                item=item,
                client_id=client_map[normalize_entity_name(item.client_name)],
                product_id=product_map[normalize_entity_name(item.product_name)],
            )
            for item in movement.items
        ]
        salary_rows = [
            {
                "movement_id": movement.external_id,
                "employee_id": employee_map[normalize_entity_name(salary.employee_name)],
                "subtotal": salary.subtotal,
            }
            for salary in movement.salaries
        ]
        client_payment_rows = [
            SyncService._build_sync_full_movement_client_payment_row(
                movement=movement,
                client_payment=client_payment,
                client_id=client_map[normalize_entity_name(client_payment.client_name)],
            )
            for client_payment in movement.client_payments
        ]
        return {
            "type": MovementType(movement.type),
            "date": movement.date,
            "amount": SyncService._coerce_sync_full_movement_amount(movement),
            "description": movement.description,
            "source": movement.source,
            "item_rows": item_rows,
            "salary_rows": salary_rows,
            "client_payment_rows": client_payment_rows,
        }

    @staticmethod
    def _movement_equals_sheet_snapshot(db_movement: Movement, sheet_snapshot: dict) -> bool:
        db_items = sorted(
            [
                (
                    str(item.client_id),
                    str(item.product_id),
                    item.quantity,
                    item.unit_price,
                    item.subtotal,
                )
                for item in db_movement.items
            ]
        )
        sheet_items = sorted(
            [
                (
                    str(row["client_id"]),
                    str(row["product_id"]),
                    row["quantity"],
                    row["unit_price"],
                    row["subtotal"],
                )
                for row in sheet_snapshot["item_rows"]
            ]
        )
        db_salaries = sorted([(str(salary.employee_id), salary.subtotal) for salary in db_movement.salaries])
        sheet_salaries = sorted([(str(row["employee_id"]), row["subtotal"]) for row in sheet_snapshot["salary_rows"]])
        db_client_payments = sorted(
            [(str(payment.client_id), payment.subtotal) for payment in db_movement.client_payments]
        )
        sheet_client_payments = sorted(
            [(str(row["client_id"]), row["subtotal"]) for row in sheet_snapshot["client_payment_rows"]]
        )

        return (
            db_movement.date == sheet_snapshot["date"]
            and db_movement.type == sheet_snapshot["type"]
            and db_movement.amount == sheet_snapshot["amount"]
            and db_items == sheet_items
            and db_salaries == sheet_salaries
            and db_client_payments == sheet_client_payments
        )

    @staticmethod
    def _replace_details_for_movement(
        db: Session,
        movement_id: UUID,
        *,
        item_rows: list[dict],
        salary_rows: list[dict],
        client_payment_rows: list[dict],
    ) -> None:
        db.execute(delete(MovementItem).where(MovementItem.movement_id == movement_id))
        db.execute(delete(MovementSalary).where(MovementSalary.movement_id == movement_id))
        db.execute(delete(MovementClientPayment).where(MovementClientPayment.movement_id == movement_id))
        if item_rows:
            db.execute(pg_insert(MovementItem).values(item_rows))
        if salary_rows:
            db.execute(pg_insert(MovementSalary).values(salary_rows))
        if client_payment_rows:
            db.execute(pg_insert(MovementClientPayment).values(client_payment_rows))

    @staticmethod
    def _soft_delete_movement_for_sync(db: Session, movement_id: UUID, deleted_at: datetime) -> None:
        movement = db.get(Movement, movement_id)
        if movement is None or movement.deleted_at is not None:
            return
        if movement.source == "app-entrega":
            return
        movement.deleted_at = deleted_at
        movement.updated_at = deleted_at
        movement.source = "sheet"

    @staticmethod
    def _coerce_sync_full_movement_amount(movement) -> Decimal:
        movement_type = MovementType(movement.type)

        if movement_type in (MovementType.COMPRA, MovementType.VENTA) and movement.items:
            normalized_clients = [normalize_entity_name(item.client_name) for item in movement.items]
            if all(es_cliente_sin_monto(name) for name in normalized_clients):
                if movement.amount != ZERO:
                    SyncService._logger.warning(
                        "Amount > 0 recibido para movimiento con clientes sin monto. movement_id=%s incoming=%s -> 0",
                        movement.external_id,
                        movement.amount,
                    )
                return ZERO
            return sum((item.subtotal for item in movement.items), ZERO)

        if movement_type in (MovementType.SUELDO, MovementType.SALDO_INICIAL) and movement.salaries:
            return sum((salary.subtotal for salary in movement.salaries), ZERO)

        if movement_type == MovementType.PAGO_CLIENTE and movement.client_payments:
            return sum((client_payment.subtotal for client_payment in movement.client_payments), ZERO)

        return movement.amount

    @staticmethod
    def _build_sync_movement_item_row(item, client_id: UUID, product_id: UUID) -> dict:
        normalized_client_name = normalize_entity_name(item.client_name)
        unit_price, unit_price_overridden = coerce_zero_if_special_client(normalized_client_name, item.unit_price)
        subtotal, subtotal_overridden = coerce_zero_if_special_client(normalized_client_name, item.subtotal)
        if es_cliente_sin_monto(normalized_client_name):
            if unit_price_overridden or subtotal_overridden:
                SyncService._logger.warning(
                    "Item con monto > 0 para cliente sin monto. movement_id=%s client=%s unit_price=%s subtotal=%s -> 0",
                    item.movement_id,
                    normalized_client_name,
                    item.unit_price,
                    item.subtotal,
                )
        return {
            "id": item.id,
            "movement_id": item.movement_id,
            "client_id": client_id,
            "product_id": product_id,
            "quantity": item.quantity,
            "unit_price": unit_price,
            "subtotal": subtotal,
        }

    @staticmethod
    def _build_sync_movement_client_payment_row(item, client_id: UUID) -> dict:
        normalized_client_name = normalize_entity_name(item.client_name)
        subtotal, subtotal_overridden = coerce_zero_if_special_client(normalized_client_name, item.subtotal)
        if es_cliente_sin_monto(normalized_client_name):
            if subtotal_overridden:
                SyncService._logger.warning(
                    "Client payment con subtotal > 0 para cliente sin monto. movement_id=%s client=%s subtotal=%s -> 0",
                    item.movement_id,
                    normalized_client_name,
                    item.subtotal,
                )
        return {
            "id": item.id,
            "movement_id": item.movement_id,
            "client_id": client_id,
            "subtotal": subtotal,
        }

    @staticmethod
    def _build_sync_full_movement_item_row(movement, item, client_id: UUID, product_id: UUID) -> dict:
        normalized_client_name = normalize_entity_name(item.client_name)
        unit_price, unit_price_overridden = coerce_zero_if_special_client(normalized_client_name, item.unit_price)
        subtotal, subtotal_overridden = coerce_zero_if_special_client(normalized_client_name, item.subtotal)
        if es_cliente_sin_monto(normalized_client_name):
            if unit_price_overridden or subtotal_overridden:
                SyncService._logger.warning(
                    "Sync full item con monto > 0 para cliente sin monto. movement_id=%s client=%s unit_price=%s subtotal=%s -> 0",
                    movement.external_id,
                    normalized_client_name,
                    item.unit_price,
                    item.subtotal,
                )
        return {
            "movement_id": movement.external_id,
            "client_id": client_id,
            "product_id": product_id,
            "quantity": item.quantity,
            "unit_price": unit_price,
            "subtotal": subtotal,
        }

    @staticmethod
    def _build_sync_full_movement_client_payment_row(movement, client_payment, client_id: UUID) -> dict:
        return {
            "movement_id": movement.external_id,
            "client_id": client_id,
            # "Clientes sin monto" applies to prices and movement items, not
            # to money received from a client. Coercing this value to zero
            # caused valid client payments to be exported as 0.
            "subtotal": client_payment.subtotal,
        }

