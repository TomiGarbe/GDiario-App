from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Index, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.core.db import Base
from app.utils.name_normalization import normalize_name

if TYPE_CHECKING:
    from app.models.movement_client_payment import MovementClientPayment
    from app.models.movement_item import MovementItem
    from app.models.price import Price


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)

    movement_items: Mapped[list["MovementItem"]] = relationship("MovementItem", back_populates="client")
    movement_client_payments: Mapped[list["MovementClientPayment"]] = relationship(
        "MovementClientPayment",
        back_populates="client",
    )
    prices: Mapped[list["Price"]] = relationship("Price", back_populates="client", cascade="all, delete-orphan")

    @validates("name")
    def _normalize_name(self, _key: str, value: str) -> str:
        return normalize_name(value)


Index("uq_clients_name_ci", func.lower(Client.name), unique=True)
Index("ix_clients_name", Client.name)
