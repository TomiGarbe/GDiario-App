from fastapi import FastAPI

from app.api.router import api_router
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="GDiario API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://project-bc4si.vercel.app"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"message": "API running"}


app.include_router(api_router, prefix="/api")
