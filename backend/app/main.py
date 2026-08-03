import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.api.router import api_router
from app.core.migrations import run_startup_migrations
from app.core.observability import ObservabilityMiddleware, configure_logging

configure_logging()
app = FastAPI(title="GDiario API")
@app.on_event("startup")
async def startup() -> None:
    # Migrations must normally run once in the deployment job. Running Alembic
    # in every Gunicorn worker races on scale-out and delays readiness.
    if os.getenv("RUN_STARTUP_MIGRATIONS", "false").strip().lower() == "true":
        run_startup_migrations()

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
