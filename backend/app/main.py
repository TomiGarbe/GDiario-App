from fastapi import FastAPI

from app.api.router import api_router

app = FastAPI(title="GDiario API")


@app.get("/")
def root():
    return {"message": "API running"}


app.include_router(api_router, prefix="/api")
