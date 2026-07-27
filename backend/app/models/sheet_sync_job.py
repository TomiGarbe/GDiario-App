from __future__ import annotations

import enum
from datetime import date, datetime
from uuid import UUID

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, Text, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class SheetSyncAction(str, enum.Enum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"


class SheetSyncStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    SYNCED = "synced"
    TEMPORARY_ERROR = "temporary_error"
    DEFINITIVE_ERROR = "definitive_error"


class SheetSyncJob(Base):
    __tablename__ = "sheet_sync_jobs"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    movement_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("movements.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    period_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    sheet_id: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[SheetSyncAction] = mapped_column(
        Enum(SheetSyncAction, name="sheet_sync_action", native_enum=True),
        nullable=False,
        index=True,
    )
    status: Mapped[SheetSyncStatus] = mapped_column(
        Enum(SheetSyncStatus, name="sheet_sync_status", native_enum=True),
        nullable=False,
        server_default=text("'PENDING'"),
        index=True,
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("6"))
    next_retry_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_stack_trace: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_http_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    movement_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    company_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_names: Mapped[str | None] = mapped_column(Text, nullable=True)
    employee_names: Mapped[str | None] = mapped_column(Text, nullable=True)
    movement_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    movement_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    processing_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
