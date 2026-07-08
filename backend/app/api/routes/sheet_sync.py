from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import require_admin_user
from app.models.movement import Movement
from app.models.sheet_sync_job import SheetSyncJob, SheetSyncStatus
from app.services.sheet_sync_service import SheetSyncService

router = APIRouter(
    prefix="/admin/sheet-sync",
    tags=["admin-sheet-sync"],
    dependencies=[Depends(require_admin_user)],
)


class SheetSyncJobOut(BaseModel):
    id: UUID
    movement_id: UUID
    period_id: int
    sheet_id: str
    action: str
    status: str
    attempts: int
    max_attempts: int
    next_retry_at: datetime | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    movement_date: str | None = None
    movement_type: str | None = None
    movement_amount: str | None = None
    movement_description: str | None = None


class ProcessDueOut(BaseModel):
    processed: int
    succeeded: int
    failed: int


def _enum_text(value) -> str:
    raw = value.value if hasattr(value, "value") else value
    return str(raw or "").strip().lower()


def _job_out(row: tuple[SheetSyncJob, Movement | None]) -> SheetSyncJobOut:
    job, movement = row
    return SheetSyncJobOut(
        id=job.id,
        movement_id=job.movement_id,
        period_id=job.period_id,
        sheet_id=job.sheet_id,
        action=_enum_text(job.action),
        status=_enum_text(job.status),
        attempts=job.attempts,
        max_attempts=job.max_attempts,
        next_retry_at=job.next_retry_at,
        last_error=job.last_error,
        created_at=job.created_at,
        updated_at=job.updated_at,
        completed_at=job.completed_at,
        movement_date=str(movement.date) if movement is not None and movement.date is not None else None,
        movement_type=_enum_text(movement.type) if movement is not None and movement.type is not None else None,
        movement_amount=str(movement.amount) if movement is not None and movement.amount is not None else None,
        movement_description=movement.description if movement is not None else None,
    )


@router.get("/jobs", response_model=list[SheetSyncJobOut])
def list_sheet_sync_jobs(
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[SheetSyncJobOut]:
    stmt = (
        select(SheetSyncJob, Movement)
        .join(Movement, Movement.id == SheetSyncJob.movement_id, isouter=True)
        .order_by(SheetSyncJob.updated_at.desc(), SheetSyncJob.created_at.desc())
        .limit(limit)
    )
    if status_filter:
        try:
            status_value = SheetSyncStatus(str(status_filter).strip().lower())
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status") from exc
        stmt = stmt.where(SheetSyncJob.status == status_value)
    rows = db.execute(stmt).all()
    return [_job_out(row) for row in rows]


@router.post("/jobs/{job_id}/retry", response_model=SheetSyncJobOut)
def retry_sheet_sync_job(job_id: UUID, db: Session = Depends(get_db)) -> SheetSyncJobOut:
    job = SheetSyncService.reset_for_retry(db, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet sync job not found")
    SheetSyncService.process_job(db, job_id)
    row = db.execute(
        select(SheetSyncJob, Movement)
        .join(Movement, Movement.id == SheetSyncJob.movement_id, isouter=True)
        .where(SheetSyncJob.id == job_id)
    ).one()
    return _job_out(row)


@router.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sheet_sync_job(job_id: UUID, db: Session = Depends(get_db)) -> None:
    deleted = SheetSyncService.delete_job(db, job_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sheet sync job not found")


@router.post("/process-due", response_model=ProcessDueOut)
def process_due_sheet_sync_jobs(
    limit: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db),
) -> ProcessDueOut:
    result = SheetSyncService.process_due(db, limit=limit)
    return ProcessDueOut(**result)
