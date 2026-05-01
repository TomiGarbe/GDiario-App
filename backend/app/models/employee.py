from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import Index, String, func, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.movement_salary import MovementSalary


class Employee(Base):
    __tablename__ = "employees"

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)

    movement_salaries: Mapped[list["MovementSalary"]] = relationship(
        "MovementSalary",
        back_populates="employee",
    )


Index("uq_employees_name_ci", func.lower(Employee.name), unique=True)
Index("ix_employees_name", Employee.name)
