from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401
from app.api.router import api_router
from app.core.db import Base, engine

app = FastAPI(title="GDiario API")

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


@app.on_event("startup")
def on_startup() -> None:
    print("APP START")
    Base.metadata.create_all(bind=engine)


@app.get("/")
def root():
    return {"message": "API running"}


app.include_router(api_router, prefix="/api")
