from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.schemas.sync import (
    SyncFullRequest,
    SyncFullResponse,
    MovementClientPaymentSyncPayload,
    MovementItemSyncPayload,
    MovementSalarySyncPayload,
    MovementSyncPayload,
    SyncBatchResult,
)
from app.services.sync_service import SyncService

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/movements", response_model=SyncBatchResult, status_code=status.HTTP_200_OK)
def sync_movements(data: list[MovementSyncPayload], db: Session = Depends(get_db)) -> SyncBatchResult:
    try:
        with db.begin():
            received, inserted, updated = SyncService.sync_movements(db=db, movements=data)
        return SyncBatchResult(received=received, inserted=inserted, updated=updated, deleted=0)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Integrity error syncing movements") from exc


@router.post("/movement-items", response_model=SyncBatchResult, status_code=status.HTTP_200_OK)
def sync_movement_items(data: list[MovementItemSyncPayload], db: Session = Depends(get_db)) -> SyncBatchResult:
    try:
        with db.begin():
            received, inserted, deleted = SyncService.sync_movement_items(db=db, items=data)
        return SyncBatchResult(received=received, inserted=inserted, updated=0, deleted=deleted)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Integrity error syncing movement items") from exc


@router.post("/movement-salaries", response_model=SyncBatchResult, status_code=status.HTTP_200_OK)
def sync_movement_salaries(data: list[MovementSalarySyncPayload], db: Session = Depends(get_db)) -> SyncBatchResult:
    try:
        with db.begin():
            received, inserted, deleted = SyncService.sync_movement_salaries(db=db, salaries=data)
        return SyncBatchResult(received=received, inserted=inserted, updated=0, deleted=deleted)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Integrity error syncing movement salaries") from exc


@router.post("/movement-client-payments", response_model=SyncBatchResult, status_code=status.HTTP_200_OK)
def sync_movement_client_payments(data: list[MovementClientPaymentSyncPayload], db: Session = Depends(get_db)) -> SyncBatchResult:
    try:
        with db.begin():
            received, inserted, deleted = SyncService.sync_movement_client_payments(db=db, client_payments=data)
        return SyncBatchResult(received=received, inserted=inserted, updated=0, deleted=deleted)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Integrity error syncing movement client payments") from exc


@router.post("/full", response_model=SyncFullResponse, status_code=status.HTTP_200_OK)
def sync_full(data: SyncFullRequest, db: Session = Depends(get_db)) -> SyncFullResponse:
    try:
        with db.begin():
            result = SyncService.sync_full(
                db=db,
                movements=data.movements,
                items=data.movement_items,
                salaries=data.movement_salaries,
                client_payments=data.movement_client_payments,
            )
        return SyncFullResponse(**result)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Integrity error syncing full payload") from exc
