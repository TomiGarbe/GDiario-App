from __future__ import annotations

from datetime import date
from uuid import UUID

from sqlalchemy import Date, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

class Period(Base):
    __tablename__ = "periods"
    __table_args__ = (
        UniqueConstraint("year", "month", name="uq_period_year_month"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    month: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    sheet_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Movement.period_id is an external period number (int), not an FK to periods.id.
    # Keep this model independent to avoid invalid ORM relationship configuration.
