"""Low-overhead request and SQL observability for production diagnosis."""
from __future__ import annotations

import contextvars
import json
import logging
import time
import traceback
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

try:
    import psutil
except ImportError:  # pragma: no cover - optional locally, required in production
    psutil = None


request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
request_user_var: contextvars.ContextVar[dict[str, str | None] | None] = contextvars.ContextVar(
    "request_user", default=None
)
# FastAPI runs synchronous endpoints in worker threads. Context variables are
# copied into those threads, so this intentionally stores a mutable request
# accumulator; the copied contexts still reference the same object.
db_timing_var: contextvars.ContextVar[dict[str, float] | None] = contextvars.ContextVar(
    "db_timing", default=None
)


class JsonFormatter(logging.Formatter):
    """One JSON object per line, suitable for Azure App Service log streaming."""

    _standard = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {
        "message", "asctime", "taskName"
    }

    def format(self, record: logging.LogRecord) -> str:
        event: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        user_context = request_user_var.get()
        if user_context and user_context["value"]:
            event["user"] = user_context["value"]
        for key, value in record.__dict__.items():
            if key not in self._standard and not key.startswith("_"):
                event[key] = value
        if record.exc_info:
            event["stacktrace"] = "".join(traceback.format_exception(*record.exc_info))
        return json.dumps(event, default=str, ensure_ascii=False)


def configure_logging() -> None:
    root = logging.getLogger()
    if getattr(root, "_gdiario_json_configured", False):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    root._gdiario_json_configured = True  # type: ignore[attr-defined]
    logging.getLogger("uvicorn.access").propagate = False


def add_db_time(seconds: float) -> None:
    timing = db_timing_var.get()
    if timing is not None:
        timing["seconds"] += seconds


def current_request_id() -> str:
    return request_id_var.get()


def set_request_user(user: str | None) -> None:
    user_context = request_user_var.get()
    if user_context is not None:
        user_context["value"] = user


def process_memory_bytes() -> int | None:
    if psutil is None:
        return None
    return int(psutil.Process().memory_info().rss)


class ObservabilityMiddleware:
    """ASGI middleware so errors and streamed responses retain request context."""

    def __init__(self, app: Callable) -> None:
        self.app = app
        self.logger = logging.getLogger("app.request")

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming_headers = dict(scope.get("headers", []))
        supplied_id = incoming_headers.get(b"x-request-id", b"").decode("ascii", "ignore").strip()
        request_id = supplied_id[:128] if supplied_id else str(uuid.uuid4())
        request_token = request_id_var.set(request_id)
        user_token = request_user_var.set({"value": None})
        db_token = db_timing_var.set({"seconds": 0.0})
        started = time.perf_counter()
        cpu_started = time.process_time()
        memory_before = process_memory_bytes()
        status_code = 500

        async def send_with_request_id(message: dict) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode("ascii", "ignore")))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            self.logger.exception(
                "request_failed",
                extra={
                    "event": "request_failed", "method": scope["method"],
                    "path": scope["path"], "status_code": 500,
                },
            )
            raise
        finally:
            elapsed = time.perf_counter() - started
            cpu_elapsed = time.process_time() - cpu_started
            level = logging.ERROR if elapsed >= 2 else logging.WARNING if elapsed >= 0.5 else logging.INFO
            db_seconds = (db_timing_var.get() or {"seconds": 0.0})["seconds"]
            self.logger.log(
                level,
                "request_completed",
                extra={
                    "event": "request_completed", "method": scope["method"],
                    "path": scope["path"], "status_code": status_code,
                    "duration_ms": round(elapsed * 1000, 2),
                    "cpu_time_ms": round(cpu_elapsed * 1000, 2),
                    "db_time_ms": round(db_seconds * 1000, 2),
                    "logic_time_ms": round(max(0, elapsed - db_seconds) * 1000, 2),
                    "memory_rss_bytes": process_memory_bytes(),
                    "memory_delta_bytes": None if memory_before is None or process_memory_bytes() is None else process_memory_bytes() - memory_before,
                },
            )
            db_timing_var.reset(db_token)
            request_user_var.reset(user_token)
            request_id_var.reset(request_token)
