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
    SyncPricesRequest,
    SyncPricesResponse,
)
from app.services.sync_clients_service import SyncClientsService
from app.services.sync_movements_service import SyncMovementsService
from app.services.sync_prices_service import SyncPricesService
from app.services.sync_service import SyncService

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/export", response_model=SyncExportResponse, status_code=status.HTTP_200_OK)
def export_data(db: Session = Depends(get_db)) -> SyncExportResponse:
    return SyncService.export_data(db)


@router.post("/clients", response_model=SyncClientsResponse, status_code=status.HTTP_200_OK)
def sync_clients(data: SyncClientsRequest, db: Session = Depends(get_db)) -> SyncClientsResponse:
    try:
        received, created = SyncClientsService.sync_clients(db, data.names)
        return SyncClientsResponse(received=received, created=created)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/prices", response_model=SyncPricesResponse, status_code=status.HTTP_200_OK)
def sync_prices(data: SyncPricesRequest, db: Session = Depends(get_db)) -> SyncPricesResponse:
    try:
        received, upserted = SyncPricesService.sync_prices(db, data.prices)
        return SyncPricesResponse(received=received, upserted=upserted)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/movements", response_model=SyncMovementsResponse, status_code=status.HTTP_200_OK)
def sync_movements(data: SyncMovementsRequest, db: Session = Depends(get_db)) -> SyncMovementsResponse:
    try:
        received, inserted = SyncMovementsService.sync_movements(db, data.movements)
        return SyncMovementsResponse(received=received, inserted=inserted)
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
