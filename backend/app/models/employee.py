from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Boolean, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.movement import Movement
    from app.models.movement_detail import MovementDetail


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)

    movements: Mapped[list["Movement"]] = relationship(
        "Movement",
        back_populates="employee",
    )
    movement_details: Mapped[list["MovementDetail"]] = relationship(
        "MovementDetail",
        back_populates="employee",
    )
