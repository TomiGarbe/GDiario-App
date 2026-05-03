import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

# Load .env from backend root regardless of current working directory.
BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    database_url: str
    jwt_secret_key: str
    jwt_algorithm: str
    jwt_expire_days: int
    google_client_id: str
    allowed_emails: tuple[str, ...]
    sync_api_key: str
    google_service_account_file: str


@lru_cache
def get_settings() -> Settings:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL is not set. Define it in backend/.env")
    jwt_secret_key = os.getenv("JWT_SECRET_KEY", "").strip()
    if not jwt_secret_key:
        raise RuntimeError("JWT_SECRET_KEY is not set. Define it in backend/.env")

    google_client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not google_client_id:
        raise RuntimeError("GOOGLE_CLIENT_ID is not set. Define it in backend/.env")

    allowed_raw = os.getenv("ALLOWED_EMAILS", "").strip()
    if not allowed_raw:
        raise RuntimeError("ALLOWED_EMAILS is not set. Define it in backend/.env")
    allowed_emails = tuple(
        email.strip().lower()
        for email in allowed_raw.split(",")
        if email.strip()
    )
    if not allowed_emails:
        raise RuntimeError("ALLOWED_EMAILS is empty. Define at least one email in backend/.env")

    jwt_algorithm = os.getenv("JWT_ALGORITHM", "HS256").strip() or "HS256"
    jwt_expire_days = int(os.getenv("JWT_EXPIRE_DAYS", "365"))
    sync_api_key = os.getenv("SYNC_API_KEY", "").strip()
    if not sync_api_key:
        raise RuntimeError("SYNC_API_KEY is not set. Define it in backend/.env")
    google_service_account_file = os.getenv("GOOGLE_SERVICE_ACCOUNT_FILE", "").strip()

    return Settings(
        database_url=database_url,
        jwt_secret_key=jwt_secret_key,
        jwt_algorithm=jwt_algorithm,
        jwt_expire_days=jwt_expire_days,
        google_client_id=google_client_id,
        allowed_emails=allowed_emails,
        sync_api_key=sync_api_key,
        google_service_account_file=google_service_account_file,
    )
