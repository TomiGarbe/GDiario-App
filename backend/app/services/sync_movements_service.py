from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.sync_service import SyncService


class SyncMovementsService:
    @staticmethod
    def sync_movements(
        db: Session,
        period_id: UUID,
        items: Iterable,
        is_first_batch: bool,
    ) -> tuple[int, int, int]:
        return SyncService.insert_movements(
            db=db,
            period_id=period_id,
            movements=items,
            is_first_batch=is_first_batch,
        )
