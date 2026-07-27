"""Persistent outbox and worker for the App -> Google Sheets projection.

The database transaction is authoritative.  A job is inserted in that same
transaction and is the only path by which Google Sheets is written.
"""
from __future__ import annotations

import json
import logging
import traceback
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from googleapiclient.errors import HttpError
from sqlalchemy import or_, select, text, update
from sqlalchemy.orm import Session, selectinload

from app.core.db import SessionLocal
from app.core.config import get_settings
from app.models.movement import Movement
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem
from app.models.movement_salary import MovementSalary
from app.models.period import Period
from app.models.sheet_sync_job import SheetSyncAction, SheetSyncJob, SheetSyncStatus
from app.services.google_sheets_writer import delete_movement_from_sheets, update_movement_sheets

logger = logging.getLogger(__name__)


class SheetSyncService:
    """Transactional outbox operations.  None of these methods call Sheets."""

    MAX_ATTEMPTS = 6
    PROCESSING_LEASE = timedelta(minutes=5)
    # attempt 1 is immediate.  These are the waits *after* failed attempts 1..5.
    RETRY_DELAYS = (timedelta(seconds=30), timedelta(minutes=2), timedelta(minutes=5), timedelta(minutes=15), timedelta(minutes=30))

    @staticmethod
    def enqueue(
        db: Session,
        *,
        movement: Movement,
        sheet_id: str,
        action: SheetSyncAction,
        payload: dict | None = None,
        period_id: int | None = None,
    ) -> SheetSyncJob:
        """Add to the caller's transaction; caller is responsible for commit."""
        clients = sorted({item.client.name for item in movement.items or []} | {p.client.name for p in movement.client_payments or []})
        employees = sorted({salary.employee.name for salary in movement.salaries or []})
        job = SheetSyncJob(
            movement_id=movement.id,
            period_id=period_id if period_id is not None else movement.period_id,
            sheet_id=sheet_id,
            action=action,
            status=SheetSyncStatus.PENDING,
            attempts=0,
            max_attempts=SheetSyncService.MAX_ATTEMPTS,
            next_retry_at=datetime.now(timezone.utc),
            payload_json=json.dumps(payload or {}, default=str),
            movement_type=SheetSyncService._enum_text(movement.type),
            company_name=get_settings().company_name,
            client_names=", ".join(clients) or None,
            employee_names=", ".join(employees) or None,
            movement_description=movement.description,
            movement_date=movement.date,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(job)
        movement.sheet_sync_status = SheetSyncStatus.PENDING.value
        # Flush ensures a database constraint failure rolls back the movement too;
        # it never commits or contacts Google.
        db.flush()
        return job

    @staticmethod
    def process_due_isolated(*, limit: int = 25) -> dict[str, int]:
        """Claim rows durably, then execute them outside request sessions."""
        with SessionLocal() as db:
            job_ids = SheetSyncService._claim_due(db, limit=limit)
        succeeded = 0
        failed = 0
        for job_id in job_ids:
            with SessionLocal() as db:
                if SheetSyncService._execute_claimed(db, job_id):
                    succeeded += 1
                else:
                    failed += 1
        return {"processed": len(job_ids), "succeeded": succeeded, "failed": failed}

    @staticmethod
    def _claim_due(db: Session, *, limit: int) -> list[UUID]:
        now = datetime.now(timezone.utc)
        SheetSyncService._recover_expired_leases(db, now)
        jobs = db.scalars(
            select(SheetSyncJob)
            .where(
                SheetSyncJob.status.in_([SheetSyncStatus.PENDING, SheetSyncStatus.TEMPORARY_ERROR]),
                SheetSyncJob.attempts < SheetSyncJob.max_attempts,
                or_(SheetSyncJob.next_retry_at.is_(None), SheetSyncJob.next_retry_at <= now),
            )
            .order_by(SheetSyncJob.next_retry_at.asc(), SheetSyncJob.created_at.asc(), SheetSyncJob.id.asc())
            .limit(limit)
            .with_for_update(skip_locked=True)
        ).all()
        for job in jobs:
            job.status = SheetSyncStatus.PROCESSING
            job.processing_started_at = now
            job.attempts = int(job.attempts or 0) + 1
            job.updated_at = now
            SheetSyncService._refresh_movement_sync_status(db, job.movement_id)
        db.commit()
        return [job.id for job in jobs]

    @staticmethod
    def _recover_expired_leases(db: Session, now: datetime) -> None:
        expired_before = now - SheetSyncService.PROCESSING_LEASE
        expired = db.scalars(
            select(SheetSyncJob)
            .where(
                SheetSyncJob.status == SheetSyncStatus.PROCESSING,
                SheetSyncJob.processing_started_at < expired_before,
            )
            .with_for_update(skip_locked=True)
        ).all()
        for job in expired:
            SheetSyncService._record_failure(
                job,
                RuntimeError("Worker lease expired before the Google Sheets operation completed"),
                now,
                include_traceback=False,
            )
            SheetSyncService._refresh_movement_sync_status(db, job.movement_id)
        if expired:
            db.commit()

    @staticmethod
    def _execute_claimed(db: Session, job_id: UUID) -> bool:
        job = db.get(SheetSyncJob, job_id)
        if job is None or job.status != SheetSyncStatus.PROCESSING:
            return False
        now = datetime.now(timezone.utc)
        if not SheetSyncService._try_lock_movement(db, job.movement_id):
            # Another worker is already projecting this movement. This is not a
            # Sheets failure and must not consume one of the six attempts.
            job.status = SheetSyncStatus.PENDING
            job.attempts = max(0, int(job.attempts or 0) - 1)
            job.processing_started_at = None
            job.next_retry_at = now + timedelta(seconds=5)
            job.updated_at = now
            SheetSyncService._refresh_movement_sync_status(db, job.movement_id)
            db.commit()
            return False
        try:
            if not SheetSyncService._is_job_current(db, job):
                # An edit may move a movement away and then back to the same
                # sheet while an older delete is waiting.  Never let that old
                # intent overwrite the newest state from the App.
                job.status = SheetSyncStatus.SYNCED
                job.completed_at = now
                job.next_retry_at = None
                job.processing_started_at = None
                job.updated_at = now
                SheetSyncService._refresh_movement_sync_status(db, job.movement_id)
                db.commit()
                logger.info("Skipped superseded sheet sync job_id=%s", job.id)
                return True
            if job.action == SheetSyncAction.DELETE:
                payload = SheetSyncService._payload(job)
                delete_movement_from_sheets(
                    job.sheet_id,
                    str(job.movement_id),
                    recalculate_product_cells=SheetSyncService._previous_product_cells(payload),
                    recalculate_period_id=payload.get("recalculate_period_id"),
                )
            else:
                movement = SheetSyncService._load_movement(db, job.movement_id)
                if movement is None:
                    raise RuntimeError(f"Movement not found for sheet sync: {job.movement_id}")
                update_movement_sheets(
                    job.sheet_id,
                    movement,
                    previous_product_cells=SheetSyncService._previous_product_cells(SheetSyncService._payload(job)),
                )
            job.status = SheetSyncStatus.SYNCED
            job.completed_at = now
            job.next_retry_at = None
            job.processing_started_at = None
            job.last_error = None
            job.error_stack_trace = None
            job.error_http_status = None
            job.error_http_response = None
            job.updated_at = now
            SheetSyncService._refresh_movement_sync_status(db, job.movement_id)
            db.commit()
            return True
        except Exception as exc:
            db.rollback()
            job = db.get(SheetSyncJob, job_id)
            if job is None:
                return False
            SheetSyncService._record_failure(job, exc, now)
            SheetSyncService._refresh_movement_sync_status(db, job.movement_id)
            db.commit()
            logger.exception("Sheet sync failed. job_id=%s movement_id=%s attempt=%s", job.id, job.movement_id, job.attempts)
            return False

    @staticmethod
    def _record_failure(job: SheetSyncJob, exc: Exception, now: datetime, *, include_traceback: bool = True) -> None:
        attempts = int(job.attempts or 0)
        # A lease can expire before a worker managed to increment an old record.
        if attempts <= 0:
            attempts = 1
            job.attempts = attempts
        job.last_error = str(exc) or exc.__class__.__name__
        job.error_stack_trace = traceback.format_exc() if include_traceback else None
        status, response = SheetSyncService._http_error_details(exc)
        job.error_http_status = status
        job.error_http_response = response
        job.processing_started_at = None
        job.completed_at = None
        job.updated_at = now
        if attempts >= int(job.max_attempts or SheetSyncService.MAX_ATTEMPTS):
            job.status = SheetSyncStatus.DEFINITIVE_ERROR
            job.next_retry_at = None
            return
        job.status = SheetSyncStatus.TEMPORARY_ERROR
        job.next_retry_at = now + SheetSyncService._retry_delay(attempts)

    @staticmethod
    def reset_for_retry(db: Session, job_id: UUID) -> SheetSyncJob | None:
        """Manual retry only requeues; it intentionally never calls Sheets inline."""
        job = db.get(SheetSyncJob, job_id, with_for_update=True)
        if job is None or job.status == SheetSyncStatus.PROCESSING:
            return None
        job.status = SheetSyncStatus.PENDING
        job.attempts = 0
        job.next_retry_at = datetime.now(timezone.utc)
        job.processing_started_at = None
        job.completed_at = None
        job.updated_at = datetime.now(timezone.utc)
        SheetSyncService._refresh_movement_sync_status(db, job.movement_id)
        db.commit()
        db.refresh(job)
        return job

    @staticmethod
    def requeue_all(db: Session, *, include_definitive: bool = True) -> int:
        statuses = [SheetSyncStatus.PENDING, SheetSyncStatus.TEMPORARY_ERROR]
        if include_definitive:
            statuses.append(SheetSyncStatus.DEFINITIVE_ERROR)
        now = datetime.now(timezone.utc)
        result = db.execute(
            update(SheetSyncJob)
            .where(SheetSyncJob.status.in_(statuses))
            .values(status=SheetSyncStatus.PENDING, attempts=0, next_retry_at=now, processing_started_at=None, completed_at=None, updated_at=now)
        )
        movement_ids = db.scalars(
            select(SheetSyncJob.movement_id).where(SheetSyncJob.status == SheetSyncStatus.PENDING).distinct()
        ).all()
        for movement_id in movement_ids:
            SheetSyncService._refresh_movement_sync_status(db, movement_id)
        db.commit()
        return int(result.rowcount or 0)

    @staticmethod
    def _refresh_movement_sync_status(db: Session, movement_id: UUID) -> None:
        movement = db.get(Movement, movement_id)
        if movement is None:
            return
        # A job is a desired projection for one target spreadsheet. Older jobs
        # for that same target are historical attempts, not an unresolved state.
        jobs = db.scalars(
            select(SheetSyncJob)
            .where(SheetSyncJob.movement_id == movement_id)
            .order_by(SheetSyncJob.created_at.desc(), SheetSyncJob.id.desc())
        ).all()
        latest_by_sheet: dict[str, SheetSyncStatus] = {}
        for job in jobs:
            latest_by_sheet.setdefault(job.sheet_id, job.status)
        statuses = set(latest_by_sheet.values())
        if SheetSyncStatus.DEFINITIVE_ERROR in statuses:
            movement.sheet_sync_status = SheetSyncStatus.DEFINITIVE_ERROR.value
        elif SheetSyncStatus.PROCESSING in statuses:
            movement.sheet_sync_status = SheetSyncStatus.PROCESSING.value
        elif SheetSyncStatus.PENDING in statuses:
            movement.sheet_sync_status = SheetSyncStatus.PENDING.value
        elif SheetSyncStatus.TEMPORARY_ERROR in statuses:
            movement.sheet_sync_status = SheetSyncStatus.TEMPORARY_ERROR.value
        else:
            movement.sheet_sync_status = SheetSyncStatus.SYNCED.value

    @staticmethod
    def _is_job_current(db: Session, job: SheetSyncJob) -> bool:
        movement = db.get(Movement, job.movement_id)
        if movement is None:
            # Preserve a diagnosable failure rather than silently pretending an
            # unknown movement was deleted from an external spreadsheet.
            return False
        if movement.deleted_at is not None:
            return job.action == SheetSyncAction.DELETE
        year, month = divmod(movement.period_id, 100)
        current_sheet_id = db.scalar(select(Period.sheet_id).where(Period.year == year, Period.month == month))
        current_sheet_id = (current_sheet_id or "").strip()
        if job.action == SheetSyncAction.DELETE:
            return current_sheet_id != job.sheet_id
        return current_sheet_id == job.sheet_id

    @staticmethod
    def _try_lock_movement(db: Session, movement_id: UUID) -> bool:
        """Serialize projections of a movement across all PostgreSQL workers.

        It is a transaction-scoped advisory lock, so commits/rollbacks release
        it even if the worker crashes. PostgreSQL is the application's required
        database (UUID/enums and psycopg2 are already part of this project).
        """
        if db.bind is None or db.bind.dialect.name != "postgresql":
            return True
        return bool(
            db.scalar(text("SELECT pg_try_advisory_xact_lock(hashtext(:key))"), {"key": str(movement_id)})
        )

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
    def _payload(job: SheetSyncJob) -> dict:
        try:
            parsed = json.loads(job.payload_json or "{}")
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}

    @staticmethod
    def _previous_product_cells(payload: dict) -> set[tuple] | None:
        cells = payload.get("previous_product_cells")
        if not isinstance(cells, list):
            return None
        parsed = {tuple(cell) for cell in cells if isinstance(cell, list) and len(cell) == 3}
        return parsed or None

    @staticmethod
    def _retry_delay(attempts: int) -> timedelta:
        return SheetSyncService.RETRY_DELAYS[min(max(attempts - 1, 0), len(SheetSyncService.RETRY_DELAYS) - 1)]

    @staticmethod
    def _http_error_details(exc: Exception) -> tuple[int | None, str | None]:
        if not isinstance(exc, HttpError):
            return None, None
        status = getattr(exc.resp, "status", None)
        content = exc.content.decode("utf-8", errors="replace") if isinstance(exc.content, bytes) else str(exc.content or "")
        return int(status) if status is not None else None, content[:20_000] or None

    @staticmethod
    def _enum_text(value) -> str:
        return str(value.value if hasattr(value, "value") else value)
