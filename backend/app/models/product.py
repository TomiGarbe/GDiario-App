from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Index, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.core.db import Base
from app.utils.name_normalization import normalize_name

if TYPE_CHECKING:
    from app.models.movement_item import MovementItem
    from app.models.price import Price


class Product(Base):
    __tablename__ = "products"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)

    movement_items: Mapped[list["MovementItem"]] = relationship(
        "MovementItem",
        back_populates="product",
    )
    prices: Mapped[list["Price"]] = relationship("Price", back_populates="product", cascade="all, delete-orphan")

    @validates("name")
    def _normalize_name(self, _key: str, value: str) -> str:
        return normalize_name(value)


Index("uq_products_name_ci", func.lower(Product.name), unique=True)
Index("ix_products_name", Product.name)
