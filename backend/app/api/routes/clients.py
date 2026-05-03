from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import get_current_user
from app.schemas.client import ClientCreate, ClientResponse
from app.services.client_service import (
    ClientAlreadyExistsError,
    ClientNotFoundError,
    ClientService,
)

router = APIRouter(
    prefix="/clients",
    tags=["clients"],
    dependencies=[Depends(get_current_user)],
)


@router.post("/", response_model=ClientResponse, status_code=status.HTTP_201_CREATED)
def create_client(data: ClientCreate, db: Session = Depends(get_db)) -> ClientResponse:
    try:
        client = ClientService.create_client(db, data)
    except ClientAlreadyExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return ClientResponse.model_validate(client)


@router.get("/", response_model=list[ClientResponse])
def get_clients(db: Session = Depends(get_db)) -> list[ClientResponse]:
    clients = ClientService.get_clients(db)
    return [ClientResponse.model_validate(client) for client in clients]


@router.get("/{client_id}", response_model=ClientResponse)
def get_client_by_id(client_id: UUID, db: Session = Depends(get_db)) -> ClientResponse:
    try:
        client = ClientService.get_client_by_id(db, client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    return ClientResponse.model_validate(client)
