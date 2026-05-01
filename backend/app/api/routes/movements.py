from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Select, case, func, select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models.client import Client
from app.models.employee import Employee
from app.models.movement import Movement, MovementType
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem
from app.models.movement_salary import MovementSalary
from app.models.product import Product
from app.schemas.movement import (
    BalanceOut,
    EntitiesOut,
    MovementClientPaymentOut,
    MovementFlatOut,
    MovementItemOut,
    MovementOut,
    MovementSalaryOut,
)

router = APIRouter(prefix="/movements", tags=["movements"])


def get_signed_amount(movement: Movement) -> Decimal:
    if movement.type == MovementType.VENTA:
        return movement.amount
    return -movement.amount


def _build_movements_filters(
    *,
    period_id: UUID | None,
    date_from: date | None,
    date_to: date | None,
    movement_type: MovementType | None,
) -> list:
    filters = []
    if period_id is not None:
        filters.append(Movement.period_id == period_id)
    if date_from is not None:
        filters.append(Movement.date >= date_from)
    if date_to is not None:
        filters.append(Movement.date <= date_to)
    if movement_type is not None:
        filters.append(Movement.type == movement_type)
    return filters


def _build_movements_query(
    *,
    period_id: UUID | None,
    date_from: date | None,
    date_to: date | None,
    movement_type: MovementType | None,
) -> Select[tuple[Movement]]:
    stmt = (
        select(Movement)
        .options(
            selectinload(Movement.items).selectinload(MovementItem.client),
            selectinload(Movement.items).selectinload(MovementItem.product),
            selectinload(Movement.salaries).selectinload(MovementSalary.employee),
            selectinload(Movement.client_payments).selectinload(MovementClientPayment.client),
        )
        .order_by(Movement.date.asc())
    )
    return stmt.where(*_build_movements_filters(
        period_id=period_id,
        date_from=date_from,
        date_to=date_to,
        movement_type=movement_type,
    ))


@router.get("/", response_model=list[MovementOut])
def get_movements(
    period_id: UUID | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    type: MovementType | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[MovementOut]:
    movements = db.scalars(
        _build_movements_query(
            period_id=period_id,
            date_from=date_from,
            date_to=date_to,
            movement_type=type,
        )
    ).all()

    return [
        MovementOut(
            id=movement.id,
            date=movement.date,
            type=movement.type.value if isinstance(movement.type, MovementType) else str(movement.type),
            amount=movement.amount,
            description=movement.description,
            items=[
                MovementItemOut(
                    client=item.client.name,
                    product=item.product.name,
                    quantity=item.quantity,
                    unit_price=item.unit_price,
                    subtotal=item.subtotal,
                )
                for item in movement.items
            ],
            salaries=[
                MovementSalaryOut(
                    employee=salary.employee.name,
                    subtotal=salary.subtotal,
                )
                for salary in movement.salaries
            ],
            client_payments=[
                MovementClientPaymentOut(
                    client=client_payment.client.name,
                    subtotal=client_payment.subtotal,
                )
                for client_payment in movement.client_payments
            ],
        )
        for movement in movements
    ]


@router.get("/flat", response_model=list[MovementFlatOut])
def get_movements_flat(
    period_id: UUID | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    type: MovementType | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[MovementFlatOut]:
    movements = db.scalars(
        _build_movements_query(
            period_id=period_id,
            date_from=date_from,
            date_to=date_to,
            movement_type=type,
        )
    ).all()

    rows: list[MovementFlatOut] = []
    for movement in movements:
        rows.extend(
            MovementFlatOut(
                date=movement.date,
                type=movement.type.value if isinstance(movement.type, MovementType) else str(movement.type),
                client=item.client.name,
                product=item.product.name,
                quantity=item.quantity,
                unit_price=item.unit_price,
                subtotal=item.subtotal,
                amount=movement.amount,
            )
            for item in movement.items
        )
        rows.extend(
            MovementFlatOut(
                date=movement.date,
                type=movement.type.value if isinstance(movement.type, MovementType) else str(movement.type),
                employee=salary.employee.name,
                subtotal=salary.subtotal,
                amount=movement.amount,
            )
            for salary in movement.salaries
        )
        rows.extend(
            MovementFlatOut(
                date=movement.date,
                type=movement.type.value if isinstance(movement.type, MovementType) else str(movement.type),
                client=client_payment.client.name,
                subtotal=client_payment.subtotal,
                amount=movement.amount,
            )
            for client_payment in movement.client_payments
        )

    return rows


@router.get("/entities", response_model=EntitiesOut)
def get_entities(db: Session = Depends(get_db)) -> EntitiesOut:
    clients = db.scalars(select(Client.name).order_by(Client.name.asc())).all()
    products = db.scalars(select(Product.name).order_by(Product.name.asc())).all()
    employees = db.scalars(select(Employee.name).order_by(Employee.name.asc())).all()
    return EntitiesOut(
        clients=clients,
        products=products,
        employees=employees,
    )


@router.get("/balance", response_model=BalanceOut)
def get_balance(
    period_id: UUID | None = Query(default=None),
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    type: MovementType | None = Query(default=None),
    db: Session = Depends(get_db),
) -> BalanceOut:
    signed_amount = case(
        (Movement.type == MovementType.VENTA, Movement.amount),
        else_=-Movement.amount,
    )
    stmt = select(func.coalesce(func.sum(signed_amount), 0)).where(
        *_build_movements_filters(
            period_id=period_id,
            date_from=date_from,
            date_to=date_to,
            movement_type=type,
        )
    )
    balance = db.scalar(stmt)
    return BalanceOut(balance=Decimal(balance))
