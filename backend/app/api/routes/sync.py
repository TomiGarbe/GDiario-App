from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.sync_auth import verify_sync_key
from app.schemas.sync import (
    SyncClientsRequest,
    SyncClientsResponse,
    SyncProductsRequest,
    SyncProductsResponse,
    SyncPricesRequest,
    SyncPricesResponse,
    SyncFullRequest,
    SyncFullExportResponse,
    SyncFullResponse,
    SyncMirrorRequest,
    SyncMirrorResponse,
    MovementClientPaymentSyncPayload,
    MovementItemSyncPayload,
    MovementSalarySyncPayload,
    MovementSyncPayload,
    SyncBatchResult,
)
from app.services.sync_service import SyncService

router = APIRouter(
    prefix="/sync",
    tags=["sync"],
    dependencies=[Depends(verify_sync_key)],
)


@router.post("/clients", response_model=SyncClientsResponse, status_code=status.HTTP_200_OK)
def sync_clients(data: SyncClientsRequest, db: Session = Depends(get_db)) -> SyncClientsResponse:
    try:
        names = [item.name for item in data.clients]
        with db.begin():
            received, created, _ = SyncService.ensure_clients(db=db, names=names)
        return SyncClientsResponse(received=received, created=created)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Integrity error syncing clients") from exc


@router.post("/products", response_model=SyncProductsResponse, status_code=status.HTTP_200_OK)
def sync_products(data: SyncProductsRequest, db: Session = Depends(get_db)) -> SyncProductsResponse:
    try:
        names = [item.name for item in data.products]
        with db.begin():
            received, created, _ = SyncService.ensure_products(db=db, names=names)
        return SyncProductsResponse(received=received, created=created)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Integrity error syncing products") from exc


@router.post("/prices", response_model=SyncPricesResponse, status_code=status.HTTP_200_OK)
def sync_prices(data: SyncPricesRequest, db: Session = Depends(get_db)) -> SyncPricesResponse:
    try:
        with db.begin():
            received, upserted = SyncService.upsert_prices(db=db, prices=data.prices)
        return SyncPricesResponse(received=received, upserted=upserted)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Integrity error syncing prices") from exc


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
                period=data.period,
                movements=data.movements,
                sheet_id=data.sheet_id,
                period_id=data.period_id,
            )
        return SyncFullResponse(**result)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Integrity error syncing full payload") from exc


@router.get("/full", response_model=SyncFullExportResponse, status_code=status.HTTP_200_OK)
def get_sync_full(period_id: int, db: Session = Depends(get_db)) -> SyncFullExportResponse:
    try:
        result = SyncService.export_full(db=db, period_id=period_id)
        return SyncFullExportResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/mirror", response_model=SyncMirrorResponse, status_code=status.HTTP_200_OK)
def sync_mirror(data: SyncMirrorRequest, db: Session = Depends(get_db)) -> SyncMirrorResponse:
    try:
        with db.begin():
            result = SyncService.sync_mirror(
                db=db,
                period=data.period,
                movements=data.movements,
                since=data.since,
            )
        return SyncMirrorResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Integrity error in mirror sync") from exc
