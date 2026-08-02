import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("DATABASE_URL", "postgresql://user:pass@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test")
os.environ.setdefault("ALLOWED_EMAILS", "test@example.com")
os.environ.setdefault("SYNC_API_KEY", "test")

from app.services.google_sheets_writer import _product_date_header_indexes


def test_product_date_parser_skips_identity_and_trailing_columns() -> None:
    # A/B are labels such as Cliente/Nuevo; the last column is not a daily date.
    header = ["Cliente", "Nuevo", "01/08/2026", "02/08/2026", "Total"]
    assert list(_product_date_header_indexes(header)) == [2, 3]


def test_product_date_parser_has_no_identity_columns_on_short_header() -> None:
    assert list(_product_date_header_indexes(["Cliente", "Nuevo"])) == []
