from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models.client import Client
from app.models.movement import Movement, MovementType
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem
from app.models.movement_salary import MovementSalary
from app.models.price import Price
from app.models.product import Product
from app.schemas.movement import (
    BalanceOut,
    EntityClientOut,
    EntityProductOut,
    EntitiesOut,
    MovementCreate,
    MovementClientPaymentOut,
    MovementFlatOut,
    MovementItemOut,
    MovementOut,
    MovementSalaryOut,
    MovementUpdate,
)
from app.services.movement_service import MovementNotFoundError, MovementService

router = APIRouter(prefix="/movements", tags=["movements"])


def _to_movement_out(movement: Movement) -> MovementOut:
    return MovementOut(
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


def get_signed_amount(movement: Movement) -> Decimal:
    if movement.type == MovementType.VENTA:
        return movement.amount
    return -movement.amount


def _build_movements_filters(
    *,
    date_from: date | None,
    date_to: date | None,
    movement_type: MovementType | None,
) -> list:
    filters = []
    if date_from is not None:
        filters.append(Movement.date >= date_from)
    if date_to is not None:
        filters.append(Movement.date <= date_to)
    if movement_type is not None:
        filters.append(Movement.type == movement_type)
    return filters


def _build_movements_query(
    *,
    date_from: date | None,
    date_to: date | None,
    movement_type: MovementType | None,
    limit: int,
    offset: int,
) -> Select[tuple[Movement]]:
    stmt = (
        select(Movement)
        .options(
            selectinload(Movement.items).selectinload(MovementItem.client),
            selectinload(Movement.items).selectinload(MovementItem.product),
            selectinload(Movement.salaries).selectinload(MovementSalary.employee),
            selectinload(Movement.client_payments).selectinload(MovementClientPayment.client),
        )
        .order_by(Movement.date.asc(), Movement.created_at.asc(), Movement.id.asc())
        .limit(limit)
        .offset(offset)
    )
    return stmt.where(*_build_movements_filters(
        date_from=date_from,
        date_to=date_to,
        movement_type=movement_type,
    ))


@router.get("/", response_model=list[MovementOut])
def get_movements(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    type: MovementType | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[MovementOut]:
    movements = db.scalars(
        _build_movements_query(
            date_from=date_from,
            date_to=date_to,
            movement_type=type,
            limit=limit,
            offset=offset,
        )
    ).all()

    return [_to_movement_out(movement) for movement in movements]


@router.post("/", response_model=MovementOut, status_code=status.HTTP_201_CREATED)
def create_movement(payload: MovementCreate, db: Session = Depends(get_db)) -> MovementOut:
    try:
        movement = MovementService.create_movement(db, payload)
        return _to_movement_out(movement)
    except HTTPException:
        db.rollback()
        raise


@router.get("/flat", response_model=list[MovementFlatOut])
def get_movements_flat(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    type: MovementType | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[MovementFlatOut]:
    movements = db.scalars(
        _build_movements_query(
            date_from=date_from,
            date_to=date_to,
            movement_type=type,
            limit=limit,
            offset=offset,
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
    latest_prices_subq = (
        select(
            Price.client_id.label("client_id"),
            Price.product_id.label("product_id"),
            Price.price.label("price"),
            func.row_number()
            .over(
                partition_by=(Price.client_id, Price.product_id),
                order_by=(Price.start_date.desc(), Price.id.desc()),
            )
            .label("rn"),
        )
        .where(Price.start_date <= date.today())
        .subquery()
    )

    priced_rows = db.execute(
        select(
            Client.id,
            Client.name,
            Product.id,
            Product.name,
            latest_prices_subq.c.price,
        )
        .join(latest_prices_subq, latest_prices_subq.c.client_id == Client.id)
        .join(Product, Product.id == latest_prices_subq.c.product_id)
        .where(latest_prices_subq.c.rn == 1)
        .order_by(Client.name.asc(), Product.name.asc())
    ).all()

    clients_by_id: dict = {}
    for client_id, client_name, product_id, product_name, product_price in priced_rows:
        if client_id not in clients_by_id:
            clients_by_id[client_id] = EntityClientOut(id=client_id, name=client_name, products=[])
        clients_by_id[client_id].products.append(
            EntityProductOut(
                product_id=product_id,
                product_name=product_name,
                price=product_price,
            )
        )

    all_clients = db.scalars(select(Client).order_by(Client.name.asc())).all()
    for client in all_clients:
        if client.id not in clients_by_id:
            clients_by_id[client.id] = EntityClientOut(id=client.id, name=client.name, products=[])

    ordered_clients = sorted(clients_by_id.values(), key=lambda item: item.name.lower())
    return EntitiesOut(
        clients=ordered_clients,
    )


@router.get("/balance", response_model=BalanceOut)
def get_balance(db: Session = Depends(get_db)) -> BalanceOut:
    movements = db.query(Movement).all()

    balance = Decimal("0")

    for m in movements:
        amount = Decimal(m.amount)
        tipo = (
            m.type.value.lower()
            if hasattr(m.type, "value")
            else str(m.type).lower()
        )
        print("TIPO:", tipo, "AMOUNT:", amount)

        if tipo == "entrega_dinero":
            balance += amount
        elif tipo == "venta":
            continue
        else:
            balance -= amount

    print("TOTAL MOVEMENTS:", len(movements))
    print("BALANCE:", balance)
    return {"balance": str(balance)}


@router.get("/{movement_id}", response_model=MovementOut)
def get_movement(movement_id: UUID, db: Session = Depends(get_db)) -> MovementOut:
    try:
        movement = MovementService.get_movement_by_id(db, movement_id)
        return _to_movement_out(movement)
    except MovementNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.patch("/{movement_id}", response_model=MovementOut)
def update_movement(movement_id: UUID, payload: MovementUpdate, db: Session = Depends(get_db)) -> MovementOut:
    try:
        movement = MovementService.update_movement(db, movement_id, payload)
        return _to_movement_out(movement)
    except MovementNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except HTTPException:
        db.rollback()
        raise


@router.delete("/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_movement(movement_id: UUID, db: Session = Depends(get_db)) -> None:
    try:
        MovementService.delete_movement(db, movement_id)
    except MovementNotFoundError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
