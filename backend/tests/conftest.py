from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.core.db import SessionLocal


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    # Integration fixture against the configured DATABASE_URL.
    with SessionLocal() as db:
        db.execute(text("DELETE FROM movement_items"))
        db.execute(text("DELETE FROM movement_salaries"))
        db.execute(text("DELETE FROM movement_client_payments"))
        db.execute(text("DELETE FROM movements"))
        db.execute(text("DELETE FROM prices"))
        db.execute(text("DELETE FROM clients"))
        db.execute(text("DELETE FROM products"))
        db.execute(text("DELETE FROM employees"))
        db.commit()

    with TestClient(app) as test_client:
        yield test_client

    with SessionLocal() as db:
        db.execute(text("DELETE FROM movement_items"))
        db.execute(text("DELETE FROM movement_salaries"))
        db.execute(text("DELETE FROM movement_client_payments"))
        db.execute(text("DELETE FROM movements"))
        db.execute(text("DELETE FROM prices"))
        db.execute(text("DELETE FROM clients"))
        db.execute(text("DELETE FROM products"))
        db.execute(text("DELETE FROM employees"))
        db.commit()
