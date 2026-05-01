from __future__ import annotations

from sqlalchemy import func, insert
from sqlalchemy.orm import Session

from app.models.client import Client


class SyncClientsService:
    @staticmethod
    def normalize_name(name: str) -> str:
        return " ".join(name.strip().split()).lower()

    @staticmethod
    def sync_clients(db: Session, names: list[str]) -> tuple[int, int]:
        normalized_to_clean: dict[str, str] = {}
        for raw_name in names:
            clean_name = " ".join(raw_name.strip().split())
            if clean_name:
                normalized_to_clean[SyncClientsService.normalize_name(clean_name)] = clean_name

        if not normalized_to_clean:
            db.commit()
            return 0, 0

        normalized_names = list(normalized_to_clean.keys())
        existing_rows = db.query(Client.id, Client.name).filter(func.lower(Client.name).in_(normalized_names)).all()
        existing_normalized = {SyncClientsService.normalize_name(row.name) for row in existing_rows}

        missing_names = [
            clean_name
            for normalized_name, clean_name in normalized_to_clean.items()
            if normalized_name not in existing_normalized
        ]

        if missing_names:
            db.execute(insert(Client), [{"name": name} for name in missing_names])

        db.commit()
        return len(normalized_to_clean), len(missing_names)
