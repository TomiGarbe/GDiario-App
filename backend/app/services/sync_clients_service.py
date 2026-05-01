from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.services.sync_service import SyncService


class SyncClientsService:
    @staticmethod
    def normalize_name(name: str) -> str:
        return SyncService._normalize_name(name)

    @staticmethod
    def sync_clients(db: Session, names: Iterable[str]) -> tuple[int, int]:
        received, created, _ = SyncService.ensure_clients(db=db, names=names)
        return received, created
