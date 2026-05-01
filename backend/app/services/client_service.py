from __future__ import annotations

from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.client import Client
from app.schemas.client import ClientCreate
from app.utils.name_normalization import normalize_name


class ClientAlreadyExistsError(Exception):
    pass


class ClientNotFoundError(Exception):
    pass


class ClientService:
    @staticmethod
    def create_client(db: Session, data: ClientCreate) -> Client:
        clean_name = " ".join(data.name.strip().split())
        client = Client(
            name=clean_name,
            normalized_name=normalize_name(clean_name),
            is_special=data.is_special,
        )
        db.add(client)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise ClientAlreadyExistsError(f"Client with name '{data.name}' already exists") from exc

        db.refresh(client)
        return client

    @staticmethod
    def get_clients(db: Session) -> list[Client]:
        return db.query(Client).order_by(Client.name.asc()).all()

    @staticmethod
    def get_client_by_id(db: Session, client_id: UUID) -> Client:
        client = db.get(Client, client_id)
        if client is None:
            raise ClientNotFoundError(f"Client with id '{client_id}' was not found")
        return client
