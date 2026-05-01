from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class MovementDetailCreate(BaseModel):
    type: Literal["producto", "empleado", "gasto"]
    product: str | None = Field(default=None, max_length=120)
    employee: str | None = Field(default=None, max_length=120)
    quantity: Decimal | None = None
    unit_price: Decimal | None = None

    @field_validator("product", "employee")
    @classmethod
    def validate_optional_names(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class MovementCreate(BaseModel):
    date: date
    type: Literal["compra", "venta", "gasto", "pago", "sueldo", "entrega_dinero", "pago_cliente"]
    client: str | None = Field(default=None, max_length=120)
    employee: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    details: list[MovementDetailCreate] = Field(default_factory=list)

    @field_validator("client", "employee", "description")
    @classmethod
    def validate_optional_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class MovementUpdate(BaseModel):
    date: Optional[date] = None
    type: Literal["compra", "venta", "gasto", "pago", "sueldo", "entrega_dinero", "pago_cliente"] | None = None
    client: str | None = Field(default=None, max_length=120)
    employee: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    details: list[MovementDetailCreate]

    @field_validator("client", "employee", "description")
    @classmethod
    def validate_optional_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class MovementDetailResponse(BaseModel):
    id: UUID
    type: str
    product: str | None
    employee: str | None
    quantity: Decimal | None
    unit_price: Decimal | None
    subtotal: Decimal | None


class MovementResponse(BaseModel):
    id: UUID
    date: date
    type: str
    client: str | None
    employee: str | None
    amount: Decimal
    description: str | None
    details: list[MovementDetailResponse]

    model_config = ConfigDict(from_attributes=True)


class BalanceResponse(BaseModel):
    date: date
    total_debe: Decimal
    total_haber: Decimal
    balance: Decimal


class MovementItemOut(BaseModel):
    client: str
    product: str
    quantity: Decimal
    unit_price: Decimal
    subtotal: Decimal


class MovementSalaryOut(BaseModel):
    employee: str
    subtotal: Decimal


class MovementClientPaymentOut(BaseModel):
    client: str
    subtotal: Decimal


class MovementOut(BaseModel):
    id: UUID
    date: date
    type: str
    amount: Decimal
    description: str | None
    items: list[MovementItemOut] = Field(default_factory=list)
    salaries: list[MovementSalaryOut] = Field(default_factory=list)
    client_payments: list[MovementClientPaymentOut] = Field(default_factory=list)


class MovementFlatOut(BaseModel):
    date: date
    type: str
    client: str | None = None
    product: str | None = None
    employee: str | None = None
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    subtotal: Decimal
    amount: Decimal


class EntitiesOut(BaseModel):
    clients: list[str] = Field(default_factory=list)
    products: list[str] = Field(default_factory=list)
    employees: list[str] = Field(default_factory=list)


class BalanceOut(BaseModel):
    balance: Decimal
