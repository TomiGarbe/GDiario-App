from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Index, Text, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.core.db import Base
from app.utils.name_normalization import normalize_name

if TYPE_CHECKING:
    from app.models.movement_salary import MovementSalary


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)

    movement_salaries: Mapped[list["MovementSalary"]] = relationship(
        "MovementSalary",
        back_populates="employee",
    )

    @validates("name")
    def _normalize_name(self, _key: str, value: str) -> str:
        return normalize_name(value)


Index("uq_employees_name_ci", func.lower(Employee.name), unique=True)
Index("ix_employees_name", Employee.name)
