from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.api.router import api_router
from app.core.migrations import run_startup_migrations

app = FastAPI(title="GDiario API")


@app.on_event("startup")
def startup() -> None:
    run_startup_migrations()

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
