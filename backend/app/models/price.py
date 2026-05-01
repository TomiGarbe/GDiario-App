from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Date, ForeignKey, Index, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.client import Client


class Price(Base):
    __tablename__ = "prices"
    __table_args__ = (
        UniqueConstraint(
            "client_id",
            "product",
            "start_date",
            name="uq_prices_client_product_start_date",
        ),
        Index("ix_prices_client_product_start_date", "client_id", "product", "start_date"),
    )

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    client_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("clients.id", ondelete="CASCADE"),
        nullable=False,
    )
    product: Mapped[str] = mapped_column(String(120), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)

    client: Mapped["Client"] = relationship("Client", back_populates="prices")
