"""SQLAlchemy setup with bounded connections and SQL/transaction telemetry."""
import logging
import time

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import get_settings
from app.core.observability import add_db_time, current_request_id

settings = get_settings()

_engine_options = {
    "pool_pre_ping": True,
    "pool_size": settings.db_pool_size,
    "max_overflow": settings.db_max_overflow,
    "pool_timeout": settings.db_pool_timeout_seconds,
    "pool_recycle": settings.db_pool_recycle_seconds,
    "future": True,
}
if settings.database_url.startswith("postgresql"):
    _engine_options["connect_args"] = {
        "connect_timeout": settings.db_pool_timeout_seconds,
        "application_name": "gdiario-api",
    }

engine = create_engine(settings.database_url, **_engine_options)
logger = logging.getLogger("app.database")


@event.listens_for(engine, "connect")
def configure_postgres_connection(dbapi_connection, connection_record) -> None:
    """Bound waits at the DB itself, including accidental idle transactions."""
    if engine.dialect.name != "postgresql":
        return
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute(f"SET statement_timeout = {settings.db_statement_timeout_ms}")
        cursor.execute(f"SET lock_timeout = {settings.db_lock_timeout_ms}")
        cursor.execute(
            f"SET idle_in_transaction_session_timeout = {settings.db_idle_transaction_timeout_ms}"
        )
    finally:
        cursor.close()


@event.listens_for(Engine, "before_cursor_execute")
def before_cursor_execute(conn, cursor, statement, parameters, context, executemany) -> None:
    conn.info.setdefault("query_started_at", []).append(time.perf_counter())


@event.listens_for(Engine, "after_cursor_execute")
def after_cursor_execute(conn, cursor, statement, parameters, context, executemany) -> None:
    starts = conn.info.get("query_started_at", [])
    started = starts.pop() if starts else None
    if started is None:
        return
    elapsed = time.perf_counter() - started
    add_db_time(elapsed)
    # Do not log values/bind params: they may contain customer or auth data.
    sql = " ".join(statement.split())[:2000]
    logger.log(
        logging.WARNING if elapsed >= 0.3 else logging.DEBUG,
        "sql_query_completed",
        extra={
            "event": "sql_query", "duration_ms": round(elapsed * 1000, 2),
            "request_id": current_request_id(), "statement": sql,
            "rowcount": getattr(cursor, "rowcount", None),
        },
    )


@event.listens_for(Engine, "handle_error")
def handle_database_error(exception_context) -> None:
    starts = exception_context.connection.info.get("query_started_at", []) if exception_context.connection else []
    started = starts.pop() if starts else None
    elapsed_ms = None
    if started is not None:
        elapsed = time.perf_counter() - started
        add_db_time(elapsed)
        elapsed_ms = round(elapsed * 1000, 2)
    logger.error(
        "sql_query_failed",
        extra={
            "event": "sql_query_failed", "request_id": current_request_id(),
            "statement": " ".join((exception_context.statement or "").split())[:2000],
            "exception": exception_context.original_exception.__class__.__name__,
            "duration_ms": elapsed_ms,
        },
        exc_info=exception_context.original_exception,
    )


@event.listens_for(Engine, "begin")
def log_transaction_begin(conn) -> None:
    logger.info("transaction_begin", extra={"event": "transaction_begin", "request_id": current_request_id()})


@event.listens_for(Engine, "commit")
def log_transaction_commit(conn) -> None:
    logger.info("transaction_commit", extra={"event": "transaction_commit", "request_id": current_request_id()})


@event.listens_for(Engine, "rollback")
def log_transaction_rollback(conn) -> None:
    logger.warning("transaction_rollback", extra={"event": "transaction_rollback", "request_id": current_request_id()})


@event.listens_for(engine.pool, "checkout")
def log_pool_checkout(dbapi_connection, connection_record, connection_proxy) -> None:
    logger.debug("db_connection_checked_out", extra={"event": "db_connection_checked_out", "pool_status": engine.pool.status()})


@event.listens_for(engine.pool, "checkin")
def log_pool_checkin(dbapi_connection, connection_record) -> None:
    logger.debug("db_connection_checked_in", extra={"event": "db_connection_checked_in", "pool_status": engine.pool.status()})


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        # Do not return a failed transaction to the pool.
        db.rollback()
        raise
    finally:
        db.close()
