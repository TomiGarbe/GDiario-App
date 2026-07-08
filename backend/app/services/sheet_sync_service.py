from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import SessionLocal
from app.models.movement import Movement
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem
from app.models.movement_salary import MovementSalary
from app.models.sheet_sync_job import SheetSyncAction, SheetSyncJob, SheetSyncStatus
from app.services.google_sheets_writer import delete_movement_from_sheets, update_movement_sheets

logger = logging.getLogger(__name__)


class SheetSyncService:
    @staticmethod
    def enqueue(
        db: Session,
        *,
        movement_id: UUID,
        period_id: int,
        sheet_id: str,
        action: SheetSyncAction,
        payload: dict | None = None,
    ) -> SheetSyncJob:
        job = SheetSyncJob(
            movement_id=movement_id,
            period_id=period_id,
            sheet_id=sheet_id,
            action=action,
            status=SheetSyncStatus.PENDING,
            attempts=0,
            next_retry_at=datetime.now(timezone.utc),
            payload_json=json.dumps(payload or {}, default=str),
            updated_at=datetime.now(timezone.utc),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        return job

    @staticmethod
    def enqueue_and_try(
        db: Session,
        *,
        movement_id: UUID,
        period_id: int,
        sheet_id: str,
        action: SheetSyncAction,
        payload: dict | None = None,
    ) -> SheetSyncJob:
        job = SheetSyncService.enqueue(
            db,
            movement_id=movement_id,
            period_id=period_id,
            sheet_id=sheet_id,
            action=action,
            payload=payload,
        )
        SheetSyncService.process_job(db, job.id)
        return job

    @staticmethod
    def enqueue_and_try_isolated(
        *,
        movement_id: UUID,
        period_id: int,
        sheet_id: str,
        action: SheetSyncAction,
        payload: dict | None = None,
    ) -> SheetSyncJob:
        with SessionLocal() as db:
            return SheetSyncService.enqueue_and_try(
                db,
                movement_id=movement_id,
                period_id=period_id,
                sheet_id=sheet_id,
                action=action,
                payload=payload,
            )

    @staticmethod
    def process_due(db: Session, *, limit: int = 25) -> dict[str, int]:
        now = datetime.now(timezone.utc)
        jobs = db.scalars(
            select(SheetSyncJob)
            .where(
                SheetSyncJob.status.in_([SheetSyncStatus.PENDING, SheetSyncStatus.FAILED]),
                SheetSyncJob.attempts < SheetSyncJob.max_attempts,
                (SheetSyncJob.next_retry_at.is_(None) | (SheetSyncJob.next_retry_at <= now)),
            )
            .order_by(SheetSyncJob.created_at.asc(), SheetSyncJob.id.asc())
            .limit(limit)
        ).all()

        succeeded = 0
        failed = 0
        for job in jobs:
            if SheetSyncService.process_job(db, job.id):
                succeeded += 1
            else:
                failed += 1
        return {"processed": len(jobs), "succeeded": succeeded, "failed": failed}

    @staticmethod
    def process_job(db: Session, job_id: UUID) -> bool:
        job = db.get(SheetSyncJob, job_id)
        if job is None:
            return False
        if job.status == SheetSyncStatus.SUCCEEDED:
            return True

        now = datetime.now(timezone.utc)
        try:
            if job.action == SheetSyncAction.DELETE:
                delete_movement_from_sheets(
                    job.sheet_id,
                    str(job.movement_id),
                    recalculate_product_cells=SheetSyncService._previous_product_cells(job),
                )
            else:
                movement = SheetSyncService._load_movement(db, job.movement_id)
                if movement is None:
                    raise RuntimeError(f"Movement not found for sheet sync: {job.movement_id}")
                update_movement_sheets(
                    job.sheet_id,
                    movement,
                    previous_product_cells=SheetSyncService._previous_product_cells(job),
                )

            job.status = SheetSyncStatus.SUCCEEDED
            job.completed_at = now
            job.updated_at = now
            job.last_error = None
            db.commit()
            return True
        except Exception as exc:
            db.rollback()
            job = db.get(SheetSyncJob, job_id)
            if job is None:
                return False
            attempts = int(job.attempts or 0) + 1
            job.attempts = attempts
            job.status = SheetSyncStatus.FAILED
            job.last_error = str(exc)
            job.next_retry_at = now + SheetSyncService._retry_delay(attempts)
            job.updated_at = now
            db.commit()
            logger.exception(
                "Sheet sync job failed. job_id=%s movement_id=%s action=%s attempts=%s",
                job.id,
                job.movement_id,
                job.action.value,
                job.attempts,
            )
            return False

    @staticmethod
    def reset_for_retry(db: Session, job_id: UUID) -> SheetSyncJob | None:
        job = db.get(SheetSyncJob, job_id)
        if job is None:
            return None
        job.status = SheetSyncStatus.PENDING
        job.next_retry_at = datetime.now(timezone.utc)
        job.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(job)
        return job

    @staticmethod
    def delete_job(db: Session, job_id: UUID) -> bool:
        job = db.get(SheetSyncJob, job_id)
        if job is None:
            return False
        db.delete(job)
        db.commit()
        return True

    @staticmethod
    def _load_movement(db: Session, movement_id: UUID) -> Movement | None:
        return db.scalar(
            select(Movement)
            .where(Movement.id == movement_id, Movement.deleted_at.is_(None))
            .options(
                selectinload(Movement.items).selectinload(MovementItem.client),
                selectinload(Movement.items).selectinload(MovementItem.product),
                selectinload(Movement.salaries).selectinload(MovementSalary.employee),
                selectinload(Movement.client_payments).selectinload(MovementClientPayment.client),
            )
        )

    @staticmethod
    def _previous_product_cells(job: SheetSyncJob) -> set[tuple] | None:
        raw = job.payload_json or ""
        if not raw:
            return None
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return None
        cells = payload.get("previous_product_cells")
        if not isinstance(cells, list):
            return None
        parsed = set()
        for cell in cells:
            if not isinstance(cell, list) or len(cell) != 3:
                continue
            parsed.add(tuple(cell))
        return parsed or None

    @staticmethod
    def _retry_delay(attempts: int) -> timedelta:
        minutes = min(60 * 24, 5 * (2 ** max(0, attempts - 1)))
        return timedelta(minutes=minutes)
