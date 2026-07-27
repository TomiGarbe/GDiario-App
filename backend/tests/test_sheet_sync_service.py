import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("ALLOWED_EMAILS", "test@example.com")
os.environ.setdefault("SYNC_API_KEY", "test")

from app.models.sheet_sync_job import SheetSyncJob, SheetSyncStatus
from app.services.sheet_sync_service import SheetSyncService


def test_retry_schedule_matches_the_contract() -> None:
    assert SheetSyncService._retry_delay(1) == timedelta(seconds=30)
    assert SheetSyncService._retry_delay(2) == timedelta(minutes=2)
    assert SheetSyncService._retry_delay(3) == timedelta(minutes=5)
    assert SheetSyncService._retry_delay(4) == timedelta(minutes=15)
    assert SheetSyncService._retry_delay(5) == timedelta(minutes=30)


def test_failure_becomes_definitive_at_the_maximum_attempt() -> None:
    now = datetime.now(timezone.utc)
    job = SheetSyncJob(attempts=6, max_attempts=6, status=SheetSyncStatus.PROCESSING)
    SheetSyncService._record_failure(job, RuntimeError("network timeout"), now)
    assert job.status == SheetSyncStatus.DEFINITIVE_ERROR
    assert job.next_retry_at is None
    assert job.last_error == "network timeout"
    assert job.error_stack_trace


def test_failed_first_attempt_is_scheduled_thirty_seconds_later() -> None:
    now = datetime.now(timezone.utc)
    job = SheetSyncJob(attempts=1, max_attempts=6, status=SheetSyncStatus.PROCESSING)
    SheetSyncService._record_failure(job, RuntimeError("unavailable"), now)
    assert job.status == SheetSyncStatus.TEMPORARY_ERROR
    assert job.next_retry_at == now + timedelta(seconds=30)
