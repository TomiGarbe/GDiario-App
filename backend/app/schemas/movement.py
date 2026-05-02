from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class MovementItemIn(BaseModel):
    client: str = Field(..., min_length=1, max_length=120)
    product: str = Field(..., min_length=1, max_length=120)
    quantity: Decimal
    unit_price: Decimal
    subtotal: Decimal | None = None

    @field_validator("client", "product")
    @classmethod
    def validate_name(cls, value: str) -> str:
        clean = " ".join(value.strip().split())
        if not clean:
            raise ValueError("value cannot be empty")
        return clean


class MovementSalaryIn(BaseModel):
    employee: str = Field(..., min_length=1, max_length=120)
    subtotal: Decimal

    @field_validator("employee")
    @classmethod
    def validate_name(cls, value: str) -> str:
        clean = " ".join(value.strip().split())
        if not clean:
            raise ValueError("employee cannot be empty")
        return clean


class MovementClientPaymentIn(BaseModel):
    client: str = Field(..., min_length=1, max_length=120)
    subtotal: Decimal

    @field_validator("client")
    @classmethod
    def validate_name(cls, value: str) -> str:
        clean = " ".join(value.strip().split())
        if not clean:
            raise ValueError("client cannot be empty")
        return clean


class MovementCreate(BaseModel):
    period_id: int
    date: date
    type: Literal["compra", "venta", "gasto", "sueldo", "entrega_dinero", "pago_cliente"]
    amount: Decimal
    description: str | None = Field(default=None, max_length=500)
    items: list[MovementItemIn] | None = None
    salaries: list[MovementSalaryIn] | None = None
    client_payments: list[MovementClientPaymentIn] | None = None

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class MovementUpdate(MovementCreate):
    pass


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


class EntityProductOut(BaseModel):
    product_id: UUID
    product_name: str
    price: Decimal


class EntityClientOut(BaseModel):
    id: UUID
    name: str
    products: list[EntityProductOut] = Field(default_factory=list)


class EntitiesOut(BaseModel):
    clients: list[EntityClientOut] = Field(default_factory=list)


class BalanceOut(BaseModel):
    balance: Decimal
