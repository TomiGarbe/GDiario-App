from __future__ import annotations

from uuid import uuid4

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.client import Client
from app.models.price import Price
from app.services.sync_clients_service import SyncClientsService


class SyncPricesService:
    @staticmethod
    def sync_prices(
        db: Session,
        items: list,
    ) -> tuple[int, int]:
        if not items:
            db.commit()
            return 0, 0

        client_names = {
            SyncClientsService.normalize_name(" ".join(item.client.strip().split()))
            for item in items
            if item.client and item.client.strip()
        }
        existing_clients = db.query(Client.id, Client.name).filter(func.lower(Client.name).in_(client_names)).all()
        client_id_by_normalized_name = {
            SyncClientsService.normalize_name(row.name): row.id for row in existing_clients
        }

        dedup_map: dict[tuple, dict] = {}
        for item in items:
            normalized_client = SyncClientsService.normalize_name(item.client)
            client_id = client_id_by_normalized_name.get(normalized_client)
            if client_id is None:
                continue

            normalized_product = SyncClientsService.normalize_name(item.product)
            key = (client_id, normalized_product, item.start_date)
            dedup_map[key] = {
                "id": uuid4(),
                "client_id": client_id,
                "product": normalized_product,
                "price": item.price,
                "start_date": item.start_date,
            }

        rows = list(dedup_map.values())
        if rows:
            stmt = pg_insert(Price).values(rows)
            upsert_stmt = stmt.on_conflict_do_update(
                constraint="uq_prices_client_product_start_date",
                set_={"price": stmt.excluded.price},
            )
            db.execute(upsert_stmt)

        db.commit()
        return len(items), len(rows)
