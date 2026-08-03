import asyncio
import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.api.router import api_router
from app.core.migrations import run_startup_migrations
from app.core.observability import ObservabilityMiddleware, configure_logging
from app.services.sheet_sync_service import SheetSyncService

configure_logging()
app = FastAPI(title="GDiario API")
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup() -> None:
    worker_id = f"pid={os.getpid()}"
    logger.info("Sheet Sync Worker starting", extra={"event": "sheet_sync_worker_starting", "worker": worker_id})
    # Migrations must normally run once in the deployment job. Running Alembic
    # in every Gunicorn worker races on scale-out and delays readiness.
    try:
        if os.getenv("RUN_STARTUP_MIGRATIONS", "false").strip().lower() == "true":
            logger.warning("Running startup migrations; do not use with multiple production workers")
            run_startup_migrations()
        app.state.sheet_sync_stop = asyncio.Event()
        task = asyncio.create_task(_sheet_sync_worker(), name="sheet-sync-worker")
        task.add_done_callback(_report_sheet_sync_worker_exit)
        app.state.sheet_sync_task = task
    except Exception:
        # This is deliberately not swallowed: an app reported as ready without
        # its required outbox worker is worse than a failed startup.
        logger.exception("Sheet Sync Worker failed to start", extra={"event": "sheet_sync_worker_start_failed", "worker": worker_id})
        raise
    logger.info("Sheet Sync Worker started", extra={"event": "sheet_sync_worker_task_created", "worker": worker_id})


@app.on_event("shutdown")
async def shutdown() -> None:
    stop = getattr(app.state, "sheet_sync_stop", None)
    task = getattr(app.state, "sheet_sync_task", None)
    if stop is not None:
        stop.set()
    if task is not None:
        try:
            await task
        except asyncio.CancelledError:
            logger.warning("Sheet Sync Worker cancelled during shutdown", extra={"event": "sheet_sync_worker_cancelled", "worker": f"pid={os.getpid()}"})


def _report_sheet_sync_worker_exit(task: asyncio.Task) -> None:
    """Make an unexpected task termination visible; create_task otherwise hides it."""
    worker = f"pid={os.getpid()}"
    if task.cancelled():
        logger.warning("Sheet Sync Worker stopped", extra={"event": "sheet_sync_worker_stopped", "worker": worker, "reason": "cancelled"})
        return
    try:
        exc = task.exception()
    except asyncio.CancelledError:
        logger.warning("Sheet Sync Worker stopped", extra={"event": "sheet_sync_worker_stopped", "worker": worker, "reason": "cancelled"})
        return
    if exc is not None:
        logger.error(
            "Sheet Sync Worker crashed", exc_info=(type(exc), exc, exc.__traceback__),
            extra={"event": "sheet_sync_worker_crashed", "worker": worker},
        )
    else:
        logger.info("Sheet Sync Worker stopped", extra={"event": "sheet_sync_worker_stopped", "worker": worker, "reason": "completed"})


async def _sheet_sync_worker() -> None:
    """Poll the durable outbox; row locks make this safe across app instances."""
    worker = f"pid={os.getpid()}"
    tick = 0
    logger.info("Sheet Sync Worker started", extra={"event": "sheet_sync_worker_running", "worker": worker})
    try:
        while not app.state.sheet_sync_stop.is_set():
            tick += 1
            logger.info("Scheduler tick", extra={"event": "sheet_sync_scheduler_tick", "worker": worker, "tick": tick})
            try:
                result = await asyncio.to_thread(SheetSyncService.process_due_isolated, limit=25)
                logger.info(
                    "Sheet Sync Worker cycle complete",
                    extra={
                        "event": "sheet_sync_worker_cycle_complete", "worker": worker, "tick": tick,
                        "processed": result["processed"], "succeeded": result["succeeded"], "failed": result["failed"],
                    },
                )
            except Exception:
                # A worker-loop failure must not take down the API. Jobs stay in the
                # database and are recovered on the next poll/startup.
                logger.exception("Unexpected sheet sync worker loop failure", extra={"event": "sheet_sync_worker_tick_failed", "worker": worker, "tick": tick})
            try:
                await asyncio.wait_for(app.state.sheet_sync_stop.wait(), timeout=2)
            except asyncio.TimeoutError:
                pass
    finally:
        logger.info("Worker stopped", extra={"event": "sheet_sync_worker_loop_stopped", "worker": worker, "ticks": tick})

app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")
app.add_middleware(ObservabilityMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://project-bc4si.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "API running"}


@app.get("/debug")
def debug(request: Request):
    return {"scheme": request.url.scheme}


app.include_router(api_router, prefix="/api")
