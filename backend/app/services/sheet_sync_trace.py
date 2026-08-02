"""Per-job diagnostic trace for the durable Google Sheets worker."""
from __future__ import annotations

import contextvars
import logging
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Iterator

logger = logging.getLogger("app.sheet_sync")
_trace_var: contextvars.ContextVar["SheetSyncTrace | None"] = contextvars.ContextVar(
    "sheet_sync_trace", default=None
)


@dataclass
class SheetSyncTrace:
    job_id: str
    movement_id: str
    spreadsheet_id: str
    action: str
    started_at: float = field(default_factory=time.perf_counter)
    last_step: str = "start_job"
    timings_ms: dict[str, float] = field(default_factory=dict)

    def _extra(self, **extra: Any) -> dict[str, Any]:
        return {
            "event": "sheet_sync", "job_id": self.job_id,
            "movement_id": self.movement_id, "spreadsheet_id": self.spreadsheet_id,
            "action": self.action, **extra,
        }

    def event(self, step: str, message: str, **extra: Any) -> None:
        self.last_step = step
        logger.info(message, extra=self._extra(step=step, **extra))

    @contextmanager
    def step(self, step: str, *, bucket: str = "other", **extra: Any) -> Iterator[None]:
        self.last_step = step
        started = time.perf_counter()
        logger.info("sheet_sync_step_start", extra=self._extra(step=step, phase="start", **extra))
        try:
            yield
        except Exception as exc:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            self.timings_ms[bucket] = round(self.timings_ms.get(bucket, 0) + elapsed_ms, 2)
            logger.exception(
                "sheet_sync_step_failed",
                extra=self._extra(
                    step=step, phase="failed", duration_ms=elapsed_ms,
                    exception_type=exc.__class__.__name__, exception_message=str(exc), **extra,
                ),
            )
            raise
        else:
            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            self.timings_ms[bucket] = round(self.timings_ms.get(bucket, 0) + elapsed_ms, 2)
            logger.info(
                "sheet_sync_step_completed",
                extra=self._extra(step=step, phase="completed", duration_ms=elapsed_ms, **extra),
            )

    def snapshot(self) -> dict[str, Any]:
        total_ms = round((time.perf_counter() - self.started_at) * 1000, 2)
        return {
            "resolver_hoja_ms": self.timings_ms.get("resolve_sheet", 0),
            "resolver_fila_ms": self.timings_ms.get("resolve_row", 0),
            "resolver_columna_ms": self.timings_ms.get("resolve_column", 0),
            "leer_sheet_ms": self.timings_ms.get("read_sheet", 0),
            "escribir_ms": self.timings_ms.get("write", 0),
            "actualizar_job_ms": self.timings_ms.get("persist", 0),
            "otros_ms": self.timings_ms.get("other", 0),
            "total_ms": total_ms,
        }


@contextmanager
def job_trace(*, job_id: str, movement_id: str, spreadsheet_id: str, action: str) -> Iterator[SheetSyncTrace]:
    trace = SheetSyncTrace(job_id=job_id, movement_id=movement_id, spreadsheet_id=spreadsheet_id, action=action)
    token = _trace_var.set(trace)
    trace.event("start_job", "sheet_sync_job_started")
    try:
        yield trace
    finally:
        trace.event("end_job", "sheet_sync_job_finished", timings=trace.snapshot())
        _trace_var.reset(token)


def get_trace() -> SheetSyncTrace | None:
    return _trace_var.get()


@contextmanager
def traced_step(step: str, *, bucket: str = "other", **extra: Any) -> Iterator[None]:
    trace = get_trace()
    if trace is None:
        yield
        return
    with trace.step(step, bucket=bucket, **extra):
        yield


def log_google_response(*, operation: str, response: Any, sheet_name: str | None = None, range_name: str | None = None) -> None:
    trace = get_trace()
    if trace is None:
        return
    # Google success payloads can be large. Keep their shape and update range,
    # while failures are persisted in full by SheetSyncService.
    payload = response if isinstance(response, dict) else {}
    trace.event(
        f"google_response.{operation}", "sheet_sync_google_response",
        operation=operation, sheet_name=sheet_name, range=range_name,
        response_keys=sorted(payload.keys()),
        updated_range=(payload.get("updates") or {}).get("updatedRange"),
    )
