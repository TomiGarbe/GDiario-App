from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SyncPeriodPayload(BaseModel):
    year: int = Field(..., ge=1900, le=3000)
    month: int = Field(..., ge=1, le=12)
    name: str = Field(..., min_length=3, max_length=100)
    start_date: date
    end_date: date

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("period.name cannot be empty")
        return clean


class SyncMovementDetailPayload(BaseModel):
    type: Literal["producto", "empleado", "gasto"]
    product: str | None = Field(default=None, max_length=120)
    employee: str | None = Field(default=None, max_length=120)
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    subtotal: Decimal | None = None

    @field_validator("product", "employee")
    @classmethod
    def validate_optional_names(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class SyncMovementPayload(BaseModel):
    date: date
    type: Literal["compra", "venta", "gasto", "pago", "sueldo"]
    client: str | None = Field(default=None, max_length=120)
    employee: str | None = Field(default=None, max_length=120)
    amount: Decimal
    description: str | None = Field(default=None, max_length=500)
    details: list[SyncMovementDetailPayload] = Field(default_factory=list)

    @field_validator("client", "employee", "description")
    @classmethod
    def validate_optional_fields(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class SyncImportRequest(BaseModel):
    sheet_id: str = Field(..., min_length=1, max_length=255)
    period: SyncPeriodPayload
    movements: list[SyncMovementPayload] = Field(default_factory=list)
    prices: list["SyncPricePayload"] = Field(default_factory=list)
    is_first_batch: bool = True

    @field_validator("sheet_id")
    @classmethod
    def validate_sheet_id(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("sheet_id cannot be empty")
        return clean


class SyncImportErrorItem(BaseModel):
    movement_index: int
    message: str


class SyncPricePayload(BaseModel):
    client: str = Field(..., min_length=1, max_length=120)
    product: str = Field(..., min_length=1, max_length=120)
    price: Decimal
    start_date: date

    @field_validator("client", "product")
    @classmethod
    def validate_required_names(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("value cannot be empty")
        return clean


class SyncImportResponse(BaseModel):
    period_id: UUID
    deleted_previous_sheet_movements: int
    imported_movements: int
    failed_movements: int
    errors: list[SyncImportErrorItem]

    model_config = ConfigDict(from_attributes=True)


class SyncExportMovementItem(BaseModel):
    id: UUID
    date: date
    type: str
    client: str | None
    employee: str | None
    amount: Decimal
    description: str | None
    source: str


class SyncExportMovementDetailItem(BaseModel):
    id: UUID
    movement_id: UUID
    type: str
    product: str | None
    employee: str | None
    quantity: Decimal | None
    unit_price: Decimal | None
    subtotal: Decimal | None


class SyncExportResponse(BaseModel):
    movements: list[SyncExportMovementItem]
    movement_details: list[SyncExportMovementDetailItem]


class SyncClientsRequest(BaseModel):
    names: list[str] = Field(default_factory=list)


class SyncClientsResponse(BaseModel):
    received: int
    created: int


class SyncPricesRequest(BaseModel):
    prices: list[SyncPricePayload] = Field(default_factory=list)


class SyncPricesResponse(BaseModel):
    received: int
    upserted: int


class SyncMovementDetailByIdPayload(BaseModel):
    type: Literal["producto", "empleado", "gasto"]
    product_id: UUID | None = None
    employee_id: UUID | None = None
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    subtotal: Decimal | None = None


class SyncMovementByIdPayload(BaseModel):
    period_id: UUID
    date: date
    type: Literal["compra", "venta", "gasto", "pago", "sueldo"]
    client_id: UUID | None = None
    employee_id: UUID | None = None
    amount: Decimal
    description: str | None = Field(default=None, max_length=500)
    sheet_id: str | None = Field(default=None, max_length=255)
    sheet_tab: str | None = Field(default=None, max_length=120)
    row_number: int | None = None
    details: list[SyncMovementDetailByIdPayload] = Field(default_factory=list)

    @field_validator("description", "sheet_id", "sheet_tab")
    @classmethod
    def validate_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class SyncMovementsRequest(BaseModel):
    movements: list[SyncMovementByIdPayload] = Field(default_factory=list)


class SyncMovementsResponse(BaseModel):
    received: int
    inserted: int
