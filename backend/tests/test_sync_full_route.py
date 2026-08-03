import os
import sys
from contextlib import nullcontext
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("ALLOWED_EMAILS", "test@example.com")
os.environ.setdefault("SYNC_API_KEY", "test")

from app.api.routes import sync
from app.schemas.sync import SyncFullRequest
from app.services.export_service import ExportService
from app.services.sync_service import SyncService


class FakeSession:
    def begin(self):
        return nullcontext()


def test_full_snapshot_endpoint_uses_the_enabled_sync_engine(monkeypatch) -> None:
    payload = SyncFullRequest.model_validate(
        {
            "sheet_id": "spreadsheet-id",
            "period_id": 202608,
            "period": {"year": 2026, "month": 8, "name": "Agosto 2026"},
            "movements": [],
        }
    )
    expected = {
        "period_id": 202608,
        "movements": {"received": 0, "inserted": 0, "updated": 0, "deleted": 0},
        "movement_items": {"received": 0, "inserted": 0, "updated": 0, "deleted": 0},
        "movement_salaries": {"received": 0, "inserted": 0, "updated": 0, "deleted": 0},
        "movement_client_payments": {"received": 0, "inserted": 0, "updated": 0, "deleted": 0},
    }
    monkeypatch.setattr(SyncService, "sync_full", lambda **kwargs: expected)

    result = sync.sync_full(payload, FakeSession())

    assert result.period_id == 202608
    assert result.movements.received == 0


def test_manual_export_endpoint_uses_export_service(monkeypatch) -> None:
    expected = {
        "schema_version": "v2",
        "movements": [],
        "movement_items": [],
        "movement_salaries": [],
        "movement_client_payments": [],
    }
    monkeypatch.setattr(ExportService, "export_full", lambda **kwargs: expected)

    result = sync.export_to_sheet(202608, FakeSession())

    assert result.schema_version == "v2"
    assert result.movements == []


def test_sync_full_preserves_payment_for_a_client_without_price() -> None:
    payment = SimpleNamespace(client_name="Scurti", subtotal=Decimal("328900.0000"))
    movement = SimpleNamespace(external_id=uuid4())

    row = SyncService._build_sync_full_movement_client_payment_row(
        movement=movement,
        client_payment=payment,
        client_id=uuid4(),
    )

    assert row["subtotal"] == Decimal("328900.0000")
