from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from sqlalchemy import Boolean, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base

if TYPE_CHECKING:
    from app.models.movement import Movement


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    is_special: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    movements: Mapped[list["Movement"]] = relationship("Movement", back_populates="client")
