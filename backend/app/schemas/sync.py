from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class SyncPeriodPayload(BaseModel):
    year: int = Field(..., ge=1900, le=3000)
    month: int = Field(..., ge=1, le=12)
    name: str = Field(..., min_length=3, max_length=100)
    start_date: date | None = None
    end_date: date | None = None

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
    type: Literal["compra", "venta", "gasto", "pago", "sueldo", "entrega_dinero", "pago_cliente"]
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
    client_name: str = Field(..., min_length=1, max_length=120)
    product_name: str = Field(..., min_length=1, max_length=120)
    price: Decimal
    start_date: date

    @model_validator(mode="before")
    @classmethod
    def map_legacy_keys(cls, data):
        if not isinstance(data, dict):
            return data
        raw = dict(data)
        if "client_name" not in raw and "client" in raw:
            raw["client_name"] = raw["client"]
        if "product_name" not in raw and "product" in raw:
            raw["product_name"] = raw["product"]
        return raw

    @field_validator("client_name", "product_name")
    @classmethod
    def validate_required_names(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("value cannot be empty")
        return clean


class SyncImportResponse(BaseModel):
    period_id: int
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


class SyncPeriodRequest(BaseModel):
    sheet_id: str = Field(..., min_length=1, max_length=255)
    period: SyncPeriodPayload


class SyncPeriodResponse(BaseModel):
    period_id: int
    created: bool


class SyncClientsRequest(BaseModel):
    clients: list["SyncClientPayload"] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def map_legacy_shape(cls, data):
        if not isinstance(data, dict):
            return data
        raw = dict(data)
        if "clients" not in raw and "names" in raw:
            raw["clients"] = [{"name": str(name)} for name in (raw.get("names") or [])]
        return raw


class SyncClientsResponse(BaseModel):
    received: int
    created: int


class SyncClientPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("name cannot be empty")
        return clean


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
    date: date
    type: Literal["compra", "venta", "gasto", "pago", "sueldo", "entrega_dinero", "pago_cliente"]
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
    period_id: int
    is_first_batch: bool = True
    movements: list[SyncMovementByIdPayload] = Field(default_factory=list)


class SyncMovementsResponse(BaseModel):
    received: int
    inserted: int
    deleted_previous_sheet_movements: int


class MovementSyncPayload(BaseModel):
    id: UUID
    period_id: int
    date: date
    type: Literal["compra", "venta", "gasto", "sueldo", "entrega_dinero", "pago_cliente"]
    amount: Decimal
    description: str | None = Field(default=None, max_length=500)

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class MovementItemSyncPayload(BaseModel):
    id: UUID
    movement_id: UUID
    client_name: str = Field(..., min_length=1, max_length=120)
    product_name: str = Field(..., min_length=1, max_length=120)
    quantity: Decimal
    unit_price: Decimal
    subtotal: Decimal

    @field_validator("client_name", "product_name")
    @classmethod
    def validate_names(cls, value: str) -> str:
        clean = " ".join(value.strip().split())
        if not clean:
            raise ValueError("value cannot be empty")
        return clean


class MovementSalarySyncPayload(BaseModel):
    id: UUID
    movement_id: UUID
    employee_name: str = Field(..., min_length=1, max_length=120)
    subtotal: Decimal

    @field_validator("employee_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        clean = " ".join(value.strip().split())
        if not clean:
            raise ValueError("employee_name cannot be empty")
        return clean


class MovementClientPaymentSyncPayload(BaseModel):
    id: UUID
    movement_id: UUID
    client_name: str = Field(..., min_length=1, max_length=120)
    subtotal: Decimal

    @field_validator("client_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        clean = " ".join(value.strip().split())
        if not clean:
            raise ValueError("client_name cannot be empty")
        return clean


class SyncBatchResult(BaseModel):
    received: int
    inserted: int
    updated: int
    deleted: int


class SyncFullRequest(BaseModel):
    period: SyncPeriodPayload
    movements: list["SyncFullMovementPayload"] = Field(default_factory=list)


class SyncFullMovementItemPayload(BaseModel):
    client_name: str = Field(..., min_length=1, max_length=120)
    product_name: str = Field(..., min_length=1, max_length=120)
    quantity: Decimal
    unit_price: Decimal
    subtotal: Decimal


class SyncFullMovementSalaryPayload(BaseModel):
    employee_name: str = Field(..., min_length=1, max_length=120)
    subtotal: Decimal


class SyncFullMovementClientPaymentPayload(BaseModel):
    client_name: str = Field(..., min_length=1, max_length=120)
    subtotal: Decimal


class SyncFullMovementPayload(BaseModel):
    external_id: UUID
    type: Literal["compra", "venta", "gasto", "sueldo", "entrega_dinero", "pago_cliente"]
    date: date
    amount: Decimal
    description: str | None = Field(default=None, max_length=500)
    items: list[SyncFullMovementItemPayload] = Field(default_factory=list)
    salaries: list[SyncFullMovementSalaryPayload] = Field(default_factory=list)
    client_payments: list[SyncFullMovementClientPaymentPayload] = Field(default_factory=list)

    @field_validator("description")
    @classmethod
    def validate_description(cls, value: str | None) -> str | None:
        if value is None:
            return None
        clean = value.strip()
        return clean or None


class SyncFullResponse(BaseModel):
    period_id: int
    movements: SyncBatchResult
    movement_items: SyncBatchResult
    movement_salaries: SyncBatchResult
    movement_client_payments: SyncBatchResult


class SyncFullExportResponse(BaseModel):
    schema_version: Literal["v2"] = "v2"
    movements: list[MovementSyncPayload] = Field(default_factory=list)
    movement_items: list[MovementItemSyncPayload] = Field(default_factory=list)
    movement_salaries: list[MovementSalarySyncPayload] = Field(default_factory=list)
    movement_client_payments: list[MovementClientPaymentSyncPayload] = Field(default_factory=list)
