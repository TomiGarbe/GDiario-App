from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ClientBase(BaseModel):
    name: str = Field(..., min_length=2, max_length=120, description="Unique client name")
    is_special: bool = False

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        clean = value.strip()
        if not clean:
            raise ValueError("name cannot be empty")
        return clean


class ClientCreate(ClientBase):
    pass


class ClientResponse(ClientBase):
    id: UUID

    model_config = ConfigDict(from_attributes=True)
