from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.client import Client
    from app.models.employee import Employee
    from app.models.movement_detail import MovementDetail
    from app.models.period import Period


class Movement(Base):
    __tablename__ = "movements"
    __table_args__ = (
        CheckConstraint(
            "type IN ('compra', 'venta', 'gasto', 'pago', 'sueldo')",
            name="ck_movements_type",
        ),
        CheckConstraint(
            "source IN ('app', 'sheet')",
            name="ck_movements_source",
        ),
    )

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    period_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("periods.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    client_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("clients.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    employee_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("employees.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)

    source: Mapped[str] = mapped_column(String(20), nullable=False, default="app", server_default="app")

    sheet_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sheet_tab: Mapped[str | None] = mapped_column(String(120), nullable=True)
    row_number: Mapped[int | None] = mapped_column(Integer, nullable=True)

    period: Mapped["Period"] = relationship("Period", back_populates="movements")
    client: Mapped["Client | None"] = relationship("Client", back_populates="movements")
    employee: Mapped["Employee | None"] = relationship("Employee", back_populates="movements")
    details: Mapped[list["MovementDetail"]] = relationship(
        "MovementDetail",
        back_populates="movement",
        cascade="all, delete-orphan",
    )
