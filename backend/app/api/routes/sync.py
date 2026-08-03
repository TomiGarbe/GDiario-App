from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.sync_auth import verify_sync_key
from app.schemas.sync import (
    SyncFullRequest,
    SyncFullExportResponse,
    SyncFullResponse,
)
from app.services.sync_service import SyncService
from app.services.export_service import ExportService

router = APIRouter(
    prefix="/sync",
    tags=["sync"],
    dependencies=[Depends(verify_sync_key)],
)

@router.post("/full", response_model=SyncFullResponse, status_code=status.HTTP_200_OK)
def sync_full(data: SyncFullRequest, db: Session = Depends(get_db)) -> SyncFullResponse:
    """Single transactional Sheets -> PostgreSQL synchronization engine.

    This is intentionally the only enabled inbound route.  The Add-on sends a
    complete snapshot for one period and SyncService applies it atomically.
    """
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


@router.get("/export", response_model=SyncFullExportResponse, status_code=status.HTTP_200_OK)
def export_to_sheet(period_id: int, db: Session = Depends(get_db)) -> SyncFullExportResponse:
    """Return the PostgreSQL snapshot for the Add-on's manual Sheet rebuild."""
    try:
        result = ExportService.export_full(db=db, period_id=period_id)
        return SyncFullExportResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
