from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import String, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.movement_detail import MovementDetail
    from app.models.price import Price


class Product(Base):
    __tablename__ = "products"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)

    movement_details: Mapped[list["MovementDetail"]] = relationship(
        "MovementDetail",
        back_populates="product",
    )
    prices: Mapped[list["Price"]] = relationship("Price", back_populates="product", cascade="all, delete-orphan")
