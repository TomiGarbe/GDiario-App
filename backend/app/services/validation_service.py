from __future__ import annotations

import logging
from collections import defaultdict
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException, status

from app.models.movement import MovementType

logger = logging.getLogger(__name__)

TOLERANCE = Decimal("0.01")


class ValidationService:
    @staticmethod
    def validate_unified_movement_payload(
        movement_type: MovementType,
        amount: Decimal,
        items: list,
        salaries: list,
        client_payments: list,
    ) -> None:
        if amount is None or amount <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid movement: amount must be > 0")

        if movement_type in (MovementType.COMPRA, MovementType.VENTA):
            if not items or salaries or client_payments:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid movement structure for type '{movement_type.value}'",
                )
        elif movement_type == MovementType.SUELDO:
            if not salaries or items or client_payments:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid movement structure for type '{movement_type.value}'",
                )
        elif movement_type == MovementType.PAGO_CLIENTE:
            if not client_payments or items or salaries:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid movement structure for type '{movement_type.value}'",
                )
        elif movement_type in (MovementType.GASTO, MovementType.ENTREGA_DINERO):
            if items or salaries or client_payments:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid movement structure for type '{movement_type.value}'",
                )

    @staticmethod
    def validate_movement_fields(movement) -> None:
        if movement.date is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid movement: date cannot be null")
        if movement.amount is None or movement.amount <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid movement: amount must be > 0")
        try:
            MovementType(movement.type)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid movement type: {movement.type}") from exc

    @staticmethod
    def validate_item_fields(item) -> None:
        if item.quantity is None or item.quantity <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid movement_item: quantity must be > 0")
        if item.unit_price is None or item.unit_price <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid movement_item: unit_price must be > 0")
        if item.subtotal is None or item.subtotal <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid movement_item: subtotal must be > 0")

    @staticmethod
    def validate_salary_fields(salary) -> None:
        if salary.subtotal is None or salary.subtotal <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid movement_salary: subtotal must be > 0")

    @staticmethod
    def validate_client_payment_fields(client_payment) -> None:
        if client_payment.subtotal is None or client_payment.subtotal <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid movement_client_payment: subtotal must be > 0",
            )

    @staticmethod
    def validate_detail_type_for_movement(movement_type: MovementType, detail_kind: str) -> None:
        if detail_kind == "item" and movement_type != MovementType.COMPRA and movement_type != MovementType.VENTA:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid type for movement_items",
            )
        if detail_kind == "salary" and movement_type != MovementType.SUELDO:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid type for movement_salaries",
            )
        if detail_kind == "client_payment" and movement_type != MovementType.PAGO_CLIENTE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid type for movement_client_payments",
            )

    @staticmethod
    def validate_movement_structure(movement, items: list, salaries: list, client_payments: list) -> None:
        movement_type = MovementType(movement.type)
        item_count = len(items)
        salary_count = len(salaries)
        client_payment_count = len(client_payments)

        invalid = False
        if movement_type in (MovementType.COMPRA, MovementType.VENTA):
            invalid = item_count < 1 or salary_count > 0 or client_payment_count > 0
        elif movement_type == MovementType.SUELDO:
            invalid = salary_count < 1 or item_count > 0 or client_payment_count > 0
        elif movement_type == MovementType.PAGO_CLIENTE:
            invalid = client_payment_count < 1 or item_count > 0 or salary_count > 0
        elif movement_type in (MovementType.GASTO, MovementType.ENTREGA_DINERO):
            invalid = item_count > 0 or salary_count > 0 or client_payment_count > 0

        if invalid:
            logger.warning(
                "Invalid movement structure movement_id=%s type=%s items=%s salaries=%s client_payments=%s",
                movement.id,
                movement_type.value,
                item_count,
                salary_count,
                client_payment_count,
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid movement structure for type '{movement_type.value}'",
            )

    @staticmethod
    def validate_amount_consistency(movement, items: list, salaries: list, client_payments: list) -> None:
        movement_type = MovementType(movement.type)
        expected = Decimal("0")
        if movement_type in (MovementType.COMPRA, MovementType.VENTA):
            expected = sum((item.subtotal for item in items), Decimal("0"))
            if abs(expected - movement.amount) > TOLERANCE:
                logger.warning(
                    "Amount mismatch movement_id=%s type=%s expected=%s got=%s",
                    movement.id,
                    movement_type.value,
                    expected,
                    movement.amount,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Amount mismatch: expected {expected}, got {movement.amount}",
                )
        elif movement_type == MovementType.SUELDO:
            expected = sum((salary.subtotal for salary in salaries), Decimal("0"))
            if abs(expected - movement.amount) > TOLERANCE:
                logger.warning(
                    "Amount mismatch movement_id=%s type=%s expected=%s got=%s",
                    movement.id,
                    movement_type.value,
                    expected,
                    movement.amount,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Amount mismatch: expected {expected}, got {movement.amount}",
                )
        elif movement_type == MovementType.PAGO_CLIENTE:
            expected = sum((client_payment.subtotal for client_payment in client_payments), Decimal("0"))
            if abs(expected - movement.amount) > TOLERANCE:
                logger.warning(
                    "Amount mismatch movement_id=%s type=%s expected=%s got=%s",
                    movement.id,
                    movement_type.value,
                    expected,
                    movement.amount,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Amount mismatch: expected {expected}, got {movement.amount}",
                )
        elif movement_type in (MovementType.GASTO, MovementType.ENTREGA_DINERO) and movement.amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Amount mismatch: expected > 0, got {movement.amount}",
            )

    @staticmethod
    def validate_batch_consistency(movements: list, items: list, salaries: list, client_payments: list) -> None:
        items_by_movement: dict[UUID, list] = defaultdict(list)
        salaries_by_movement: dict[UUID, list] = defaultdict(list)
        client_payments_by_movement: dict[UUID, list] = defaultdict(list)

        for item in items:
            items_by_movement[item.movement_id].append(item)
        for salary in salaries:
            salaries_by_movement[salary.movement_id].append(salary)
        for client_payment in client_payments:
            client_payments_by_movement[client_payment.movement_id].append(client_payment)

        for movement in movements:
            current_items = items_by_movement.get(movement.id, [])
            current_salaries = salaries_by_movement.get(movement.id, [])
            current_client_payments = client_payments_by_movement.get(movement.id, [])
            ValidationService.validate_movement_structure(
                movement,
                current_items,
                current_salaries,
                current_client_payments,
            )
            ValidationService.validate_amount_consistency(
                movement,
                current_items,
                current_salaries,
                current_client_payments,
            )
