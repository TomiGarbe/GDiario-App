from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.schemas.movement import BalanceResponse, MovementCreate, MovementDetailResponse, MovementResponse, MovementUpdate
from app.services.movement_service import InvalidMovementError, MovementNotFoundError, MovementService

router = APIRouter(prefix="/movements", tags=["movements"])


def _serialize_movement(movement) -> MovementResponse:
    return MovementResponse(
        id=movement.id,
        date=movement.date,
        type=movement.type,
        client=movement.client.name if movement.client else None,
        employee=movement.employee.name if movement.employee else None,
        amount=movement.amount,
        description=movement.description,
        details=[
            MovementDetailResponse(
                id=detail.id,
                type=detail.type,
                product=detail.product.name if detail.product else None,
                employee=detail.employee.name if detail.employee else None,
                quantity=detail.quantity,
                unit_price=detail.unit_price,
                subtotal=detail.subtotal,
            )
            for detail in movement.details
        ],
    )


@router.get("/", response_model=list[MovementResponse])
def get_movements(db: Session = Depends(get_db)) -> list[MovementResponse]:
    movements = MovementService.get_movements(db)
    return [_serialize_movement(movement) for movement in movements]


@router.post("/", response_model=MovementResponse, status_code=status.HTTP_201_CREATED)
def create_movement(data: MovementCreate, db: Session = Depends(get_db)) -> MovementResponse:
    try:
        movement = MovementService.create_movement(db, data)
    except InvalidMovementError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return _serialize_movement(movement)


@router.patch("/{movement_id}", response_model=MovementResponse)
def patch_movement(movement_id: UUID, data: MovementUpdate, db: Session = Depends(get_db)) -> MovementResponse:
    try:
        movement = MovementService.update_movement(db, movement_id, data)
    except MovementNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InvalidMovementError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    return _serialize_movement(movement)


@router.get("/balance", response_model=BalanceResponse)
def get_balance(
    date_param: date = Query(alias="date"),
    db: Session = Depends(get_db),
) -> BalanceResponse:
    total_debe, total_haber, balance = MovementService.get_balance_until_date(db, date_param)
    return BalanceResponse(
        date=date_param,
        total_debe=total_debe,
        total_haber=total_haber,
        balance=balance,
    )


@router.get("/{movement_id}", response_model=MovementResponse)
def get_movement_by_id(movement_id: UUID, db: Session = Depends(get_db)) -> MovementResponse:
    try:
        movement = MovementService.get_movement_by_id(db, movement_id)
    except MovementNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return _serialize_movement(movement)


@router.delete("/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_movement(movement_id: UUID, db: Session = Depends(get_db)) -> Response:
    try:
        MovementService.delete_movement(db, movement_id)
    except MovementNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)
