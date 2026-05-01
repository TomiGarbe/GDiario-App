from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.schemas.sync import SyncExportResponse, SyncImportRequest, SyncImportResponse
from app.services.sync_service import SyncImportError, SyncService

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/export", response_model=SyncExportResponse, status_code=status.HTTP_200_OK)
def export_data(db: Session = Depends(get_db)) -> SyncExportResponse:
    return SyncService.export_data(db)


@router.post("/import-sheet", response_model=SyncImportResponse, status_code=status.HTTP_200_OK)
def import_sheet(data: SyncImportRequest, db: Session = Depends(get_db)) -> SyncImportResponse:
    try:
        return SyncService.import_sheet(db, data)
    except SyncImportError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
