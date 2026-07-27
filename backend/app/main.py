import asyncio
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.api.router import api_router
from app.core.migrations import run_startup_migrations
from app.services.sheet_sync_service import SheetSyncService

app = FastAPI(title="GDiario API")
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup() -> None:
    run_startup_migrations()
    app.state.sheet_sync_stop = asyncio.Event()
    app.state.sheet_sync_task = asyncio.create_task(_sheet_sync_worker(), name="sheet-sync-worker")


@app.on_event("shutdown")
async def shutdown() -> None:
    stop = getattr(app.state, "sheet_sync_stop", None)
    task = getattr(app.state, "sheet_sync_task", None)
    if stop is not None:
        stop.set()
    if task is not None:
        await task


async def _sheet_sync_worker() -> None:
    """Poll the durable outbox; row locks make this safe across app instances."""
    while not app.state.sheet_sync_stop.is_set():
        try:
            result = await asyncio.to_thread(SheetSyncService.process_due_isolated, limit=25)
            if result["processed"]:
                logger.info(
                    "Sheet sync worker processed=%s succeeded=%s failed=%s",
                    result["processed"], result["succeeded"], result["failed"],
                )
                continue
        except Exception:
            # A worker-loop failure must not take down the API. Jobs stay in the
            # database and are recovered on the next poll/startup.
            logger.exception("Unexpected sheet sync worker loop failure")
        try:
            await asyncio.wait_for(app.state.sheet_sync_stop.wait(), timeout=2)
        except asyncio.TimeoutError:
            pass

app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

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
