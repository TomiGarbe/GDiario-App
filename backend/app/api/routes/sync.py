from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.schemas.sync import (
    SyncClientsRequest,
    SyncClientsResponse,
    SyncExportResponse,
    SyncMovementsRequest,
    SyncMovementsResponse,
    SyncPeriodRequest,
    SyncPeriodResponse,
    SyncPricesRequest,
    SyncPricesResponse,
)
from app.services.sync_service import SyncService

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/export", response_model=SyncExportResponse, status_code=status.HTTP_200_OK)
def export_data(db: Session = Depends(get_db)) -> SyncExportResponse:
    return SyncService.export_data(db)


@router.post("/period", response_model=SyncPeriodResponse, status_code=status.HTTP_200_OK)
def sync_period(data: SyncPeriodRequest, db: Session = Depends(get_db)) -> SyncPeriodResponse:
    try:
        period, created = SyncService.sync_period(db=db, period_data=data.period, sheet_id=data.sheet_id)
        db.commit()
        return SyncPeriodResponse(period_id=period.id, created=created)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/clients", response_model=SyncClientsResponse, status_code=status.HTTP_200_OK)
def sync_clients(data: SyncClientsRequest, db: Session = Depends(get_db)) -> SyncClientsResponse:
    try:
        received, created, _ = SyncService.ensure_clients(db=db, names=data.names)
        db.commit()
        return SyncClientsResponse(received=received, created=created)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/prices", response_model=SyncPricesResponse, status_code=status.HTTP_200_OK)
def sync_prices(data: SyncPricesRequest, db: Session = Depends(get_db)) -> SyncPricesResponse:
    try:
        received, upserted = SyncService.upsert_prices(db=db, prices=data.prices)
        db.commit()
        return SyncPricesResponse(received=received, upserted=upserted)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/movements", response_model=SyncMovementsResponse, status_code=status.HTTP_200_OK)
def sync_movements(data: SyncMovementsRequest, db: Session = Depends(get_db)) -> SyncMovementsResponse:
    try:
        received, inserted, deleted = SyncService.insert_movements(
            db=db,
            period_id=data.period_id,
            movements=data.movements,
            is_first_batch=data.is_first_batch,
        )
        db.commit()
        return SyncMovementsResponse(
            received=received,
            inserted=inserted,
            deleted_previous_sheet_movements=deleted,
        )
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
