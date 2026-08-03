import asyncio
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("ALLOWED_EMAILS", "test@example.com")
os.environ.setdefault("SYNC_API_KEY", "test")

import app.main as main
from app.main import _sheet_sync_worker, app
from app.services.sheet_sync_service import SheetSyncService


def test_worker_emits_a_tick_even_when_no_jobs_are_found(monkeypatch, caplog) -> None:
    def no_jobs(*, limit: int) -> dict[str, int]:
        app.state.sheet_sync_stop.set()
        return {"processed": 0, "succeeded": 0, "failed": 0}

    async def run_worker_once() -> None:
        app.state.sheet_sync_stop = asyncio.Event()
        await _sheet_sync_worker()

    caplog.set_level(logging.INFO)
    monkeypatch.setattr(SheetSyncService, "process_due_isolated", no_jobs)
    asyncio.run(run_worker_once())

    messages = [record.getMessage() for record in caplog.records]
    assert "Sheet Sync Worker started" in messages
    assert "Scheduler tick" in messages
    assert "Sheet Sync Worker cycle complete" in messages
    assert "Worker stopped" in messages


def test_fastapi_startup_creates_the_worker_task(monkeypatch, caplog) -> None:
    started = asyncio.Event()

    async def fake_worker() -> None:
        started.set()

    async def run_startup() -> None:
        await main.startup()
        await app.state.sheet_sync_task

    caplog.set_level(logging.INFO)
    monkeypatch.setenv("RUN_STARTUP_MIGRATIONS", "false")
    monkeypatch.setattr(main, "_sheet_sync_worker", fake_worker)
    asyncio.run(run_startup())

    assert started.is_set()
    messages = [record.getMessage() for record in caplog.records]
    assert "Sheet Sync Worker starting" in messages
    assert "Sheet Sync Worker started" in messages
