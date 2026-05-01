from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.orm import Session

from app.services.sync_service import SyncService


class SyncPricesService:
    @staticmethod
    def sync_prices(
        db: Session,
        items: Iterable,
    ) -> tuple[int, int]:
        return SyncService.upsert_prices(db=db, prices=items)
