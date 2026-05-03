from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Date, DateTime, Enum, Integer, Numeric, Text, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.movement_client_payment import MovementClientPayment
    from app.models.movement_item import MovementItem
    from app.models.movement_salary import MovementSalary


class MovementType(str, enum.Enum):
    COMPRA = "compra"
    VENTA = "venta"
    GASTO = "gasto"
    SUELDO = "sueldo"
    ENTREGA_DINERO = "entrega_dinero"
    PAGO_CLIENTE = "pago_cliente"


class Movement(Base):
    __tablename__ = "movements"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    period_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    type: Mapped[MovementType] = mapped_column(
        Enum(MovementType, name="movement_type", native_enum=True),
        nullable=False,
        index=True,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=text("now()"),
        index=True,
    )
    source: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'app'"),
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    items: Mapped[list["MovementItem"]] = relationship(
        "MovementItem",
        back_populates="movement",
        cascade="all, delete-orphan",
    )
    salaries: Mapped[list["MovementSalary"]] = relationship(
        "MovementSalary",
        back_populates="movement",
        cascade="all, delete-orphan",
    )
    client_payments: Mapped[list["MovementClientPayment"]] = relationship(
        "MovementClientPayment",
        back_populates="movement",
        cascade="all, delete-orphan",
    )
