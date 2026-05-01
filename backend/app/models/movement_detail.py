from __future__ import annotations

from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Numeric, String, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.employee import Employee
    from app.models.movement import Movement
    from app.models.product import Product


class MovementDetail(Base):
    __tablename__ = "movement_details"
    __table_args__ = (
        CheckConstraint(
            "type IN ('producto', 'empleado', 'gasto')",
            name="ck_movement_details_type",
        ),
    )

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

    product_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("products.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    employee_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 4), nullable=True)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)

    type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    movement: Mapped["Movement"] = relationship("Movement", back_populates="details")
    product: Mapped["Product | None"] = relationship("Product", back_populates="movement_details")
    employee: Mapped["Employee | None"] = relationship("Employee", back_populates="movement_details")
