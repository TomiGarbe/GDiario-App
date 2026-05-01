from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.client import Client
from app.models.employee import Employee
from app.models.movement import Movement
from app.models.movement import MovementType
from app.models.product import Product
from app.repositories.movement_repository import MovementRepository
from app.services.validation_service import ValidationService
from app.utils.name_resolver import normalize_entity_name, resolve_or_create_entities


class SyncService:
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
            raise ValueError(f"Some movement_id do not exist: {sorted(str(mid) for mid in missing_movement_ids)}")
        movement_types = SyncService._get_movement_types(db, movement_ids)
        for item in item_list:
            ValidationService.validate_item_fields(item)
            ValidationService.validate_detail_type_for_movement(movement_types[item.movement_id], "item")

        client_map = resolve_or_create_entities(db, Client, [item.client_name for item in item_list])
        product_map = resolve_or_create_entities(db, Product, [item.product_name for item in item_list])

        rows = [
            {
                "id": item.id,
                "movement_id": item.movement_id,
                "client_id": client_map[normalize_entity_name(item.client_name)],
                "product_id": product_map[normalize_entity_name(item.product_name)],
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "subtotal": item.subtotal,
            }
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
            raise ValueError(f"Some movement_id do not exist: {sorted(str(mid) for mid in missing_movement_ids)}")
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
            raise ValueError(f"Some movement_id do not exist: {sorted(str(mid) for mid in missing_movement_ids)}")
        movement_types = SyncService._get_movement_types(db, movement_ids)
        for item in client_payment_list:
            ValidationService.validate_client_payment_fields(item)
            ValidationService.validate_detail_type_for_movement(movement_types[item.movement_id], "client_payment")

        client_map = resolve_or_create_entities(db, Client, [item.client_name for item in client_payment_list])

        rows = [
            {
                "id": item.id,
                "movement_id": item.movement_id,
                "client_id": client_map[normalize_entity_name(item.client_name)],
                "subtotal": item.subtotal,
            }
            for item in client_payment_list
        ]

        deleted, inserted = MovementRepository.replace_movement_client_payments(db, movement_ids, rows)
        return len(client_payment_list), inserted, deleted

    @staticmethod
    def sync_full(db: Session, movements: Iterable, items: Iterable, salaries: Iterable, client_payments: Iterable) -> dict:
        movement_list = list(movements)
        item_list = list(items)
        salary_list = list(salaries)
        client_payment_list = list(client_payments)

        movements_received, movements_inserted, movements_updated = SyncService.sync_movements(db, movement_list)
        items_received, items_inserted, items_deleted = SyncService.sync_movement_items(db, item_list)
        salaries_received, salaries_inserted, salaries_deleted = SyncService.sync_movement_salaries(db, salary_list)
        client_payments_received, client_payments_inserted, client_payments_deleted = SyncService.sync_movement_client_payments(
            db,
            client_payment_list,
        )

        movement_ids = {m.id for m in movement_list}
        if movement_ids:
            stored_movements = db.execute(select(Movement).where(Movement.id.in_(movement_ids))).scalars().all()
            ValidationService.validate_batch_consistency(stored_movements, item_list, salary_list, client_payment_list)

        return {
            "movements": {
                "received": movements_received,
                "inserted": movements_inserted,
                "updated": movements_updated,
                "deleted": 0,
            },
            "movement_items": {
                "received": items_received,
                "inserted": items_inserted,
                "updated": 0,
                "deleted": items_deleted,
            },
            "movement_salaries": {
                "received": salaries_received,
                "inserted": salaries_inserted,
                "updated": 0,
                "deleted": salaries_deleted,
            },
            "movement_client_payments": {
                "received": client_payments_received,
                "inserted": client_payments_inserted,
                "updated": 0,
                "deleted": client_payments_deleted,
            },
        }

    @staticmethod
    def _get_movement_types(db: Session, movement_ids: set[UUID]) -> dict[UUID, MovementType]:
        if not movement_ids:
            return {}
        rows = db.execute(select(Movement.id, Movement.type).where(Movement.id.in_(movement_ids))).all()
        return {movement_id: movement_type for movement_id, movement_type in rows}
