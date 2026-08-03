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
    admin_emails: tuple[str, ...]
    sync_api_key: str
    company_name: str
    db_pool_size: int
    db_max_overflow: int
    db_pool_timeout_seconds: int
    db_pool_recycle_seconds: int
    db_statement_timeout_ms: int
    db_lock_timeout_ms: int
    db_idle_transaction_timeout_ms: int


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

    admin_raw = os.getenv("ADMIN_EMAILS", "tomigarbe2003@gmail.com,cristiangarbe@gmail.com").strip()
    admin_emails = tuple(
        email.strip().lower()
        for email in admin_raw.split(",")
        if email.strip()
    )

    jwt_algorithm = os.getenv("JWT_ALGORITHM", "HS256").strip() or "HS256"
    jwt_expire_days = int(os.getenv("JWT_EXPIRE_DAYS", "365"))
    sync_api_key = os.getenv("SYNC_API_KEY", "").strip()
    if not sync_api_key:
        raise RuntimeError("SYNC_API_KEY is not set. Define it in backend/.env")
    company_name = os.getenv("COMPANY_NAME", "No configurada").strip() or "No configurada"

    # These bounded defaults prevent a saturated or blocked database from
    # turning into requests that wait forever. They can be tuned per App
    # Service instance without a deployment.
    db_pool_size = int(os.getenv("DB_POOL_SIZE", "5"))
    db_max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "5"))
    db_pool_timeout_seconds = int(os.getenv("DB_POOL_TIMEOUT_SECONDS", "15"))
    db_pool_recycle_seconds = int(os.getenv("DB_POOL_RECYCLE_SECONDS", "1800"))
    db_statement_timeout_ms = int(os.getenv("DB_STATEMENT_TIMEOUT_MS", "15000"))
    db_lock_timeout_ms = int(os.getenv("DB_LOCK_TIMEOUT_MS", "5000"))
    db_idle_transaction_timeout_ms = int(os.getenv("DB_IDLE_TRANSACTION_TIMEOUT_MS", "30000"))
    if (
        db_pool_size < 1
        or db_max_overflow < 0
        or min(
            db_pool_timeout_seconds,
            db_pool_recycle_seconds,
            db_statement_timeout_ms,
            db_lock_timeout_ms,
            db_idle_transaction_timeout_ms,
        ) <= 0
    ):
        raise RuntimeError("Database pool and timeout settings must be positive")

    return Settings(
        database_url=database_url,
        jwt_secret_key=jwt_secret_key,
        jwt_algorithm=jwt_algorithm,
        jwt_expire_days=jwt_expire_days,
        google_client_id=google_client_id,
        allowed_emails=allowed_emails,
        admin_emails=admin_emails,
        sync_api_key=sync_api_key,
        company_name=company_name,
        db_pool_size=db_pool_size,
        db_max_overflow=db_max_overflow,
        db_pool_timeout_seconds=db_pool_timeout_seconds,
        db_pool_recycle_seconds=db_pool_recycle_seconds,
        db_statement_timeout_ms=db_statement_timeout_ms,
        db_lock_timeout_ms=db_lock_timeout_ms,
        db_idle_transaction_timeout_ms=db_idle_transaction_timeout_ms,
    )
