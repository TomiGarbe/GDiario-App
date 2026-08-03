import secrets

from fastapi import Header, HTTPException, status

from app.core.config import get_settings


def verify_sync_key(x_api_key: str | None = Header(default=None)) -> None:
    settings = get_settings()
    if not x_api_key or not secrets.compare_digest(x_api_key, settings.sync_api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
