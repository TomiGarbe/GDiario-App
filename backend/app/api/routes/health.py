from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import engine, get_db

router = APIRouter()


@router.get("/health/live")
def liveness() -> dict[str, str]:
    """No dependency on PostgreSQL: use for App Service liveness probes."""
    return {"status": "ok"}


@router.get("/health/ready")
def readiness(db: Session = Depends(get_db)) -> dict[str, str]:
    """Use for readiness checks; detects pool/database connectivity failures."""
    db.execute(text("SELECT 1"))
    return {"status": "ok", "pool": engine.pool.status()}


@router.get("/test-db")
def test_db(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
