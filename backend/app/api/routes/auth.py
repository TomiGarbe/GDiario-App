from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.core.config import get_settings
from app.core.security import create_access_token, verify_google_token

router = APIRouter(prefix="/auth", tags=["auth"])


class GoogleLoginRequest(BaseModel):
    id_token: str = Field(min_length=1)


class GoogleLoginResponse(BaseModel):
    access_token: str


@router.post("/google", response_model=GoogleLoginResponse, status_code=status.HTTP_200_OK)
def google_login(data: GoogleLoginRequest) -> GoogleLoginResponse:
    settings = get_settings()
    idinfo = verify_google_token(data.id_token.strip())
    email = str(idinfo.get("email") or "").strip().lower()

    if not email:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email de Google no disponible")
    if not bool(idinfo.get("email_verified")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email de Google no verificado")
    if email not in settings.allowed_emails:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email no autorizado")

    token = create_access_token(email)
    return GoogleLoginResponse(access_token=token)
