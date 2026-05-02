from __future__ import annotations

from decimal import Decimal


def _create_movement(client, payload: dict) -> dict:
    response = client.post("/api/movements/", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_movements_and_balance_scenarios(client):
    compra = _create_movement(
        client,
        {
            "period_id": 1,
            "date": "2026-01-10",
            "type": "compra",
            "amount": "999999.0000",
            "description": "Compra insumos",
            "items": [
                {
                    "client": "Acme",
                    "product": "Yerba",
                    "quantity": "2.0000",
                    "unit_price": "50.0000",
                    "subtotal": "100.0000",
                }
            ],
        },
    )

    venta = _create_movement(
        client,
        {
            "period_id": 1,
            "date": "2026-01-11",
            "type": "venta",
            "amount": "1.0000",
            "description": "Venta local",
            "items": [
                {
                    "client": "Acme",
                    "product": "Yerba",
                    "quantity": "1.0000",
                    "unit_price": "200.0000",
                    "subtotal": "200.0000",
                }
            ],
        },
    )

    pago_cliente = _create_movement(
        client,
        {
            "period_id": 1,
            "date": "2026-01-12",
            "type": "pago_cliente",
            "amount": "1.0000",
            "description": "Pago de cuenta",
            "client_payments": [{"client": "Acme", "subtotal": "30.0000"}],
        },
    )

    gasto = _create_movement(
        client,
        {
            "period_id": 1,
            "date": "2026-01-13",
            "type": "gasto",
            "amount": "10.0000",
            "description": "Cafe",
        },
    )

    movements_resp = client.get("/api/movements/")
    assert movements_resp.status_code == 200
    movements = movements_resp.json()

    assert [m["id"] for m in movements] == [compra["id"], venta["id"], pago_cliente["id"], gasto["id"]]

    compra_out = next(m for m in movements if m["id"] == compra["id"])
    assert compra_out["items"]
    assert compra_out["items"][0]["client"] == "Acme"
    assert compra_out["items"][0]["product"] == "Yerba"
    assert compra_out["salaries"] == []
    assert compra_out["client_payments"] == []

    pago_out = next(m for m in movements if m["id"] == pago_cliente["id"])
    assert pago_out["client_payments"]
    assert pago_out["client_payments"][0]["client"] == "Acme"

    gasto_out = next(m for m in movements if m["id"] == gasto["id"])
    assert gasto_out["items"] == []
    assert gasto_out["salaries"] == []
    assert gasto_out["client_payments"] == []

    balance_resp = client.get("/api/movements/balance")
    assert balance_resp.status_code == 200
    balance = Decimal(str(balance_resp.json()["balance"]))
    # compra -100, venta +200, pago_cliente -30, gasto -10 => 60
    assert balance == Decimal("60.0000")

    venta_balance = client.get("/api/movements/balance", params={"type": "venta"})
    assert venta_balance.status_code == 200
    assert Decimal(str(venta_balance.json()["balance"])) == Decimal("200.0000")

    compra_balance = client.get("/api/movements/balance", params={"type": "compra"})
    assert compra_balance.status_code == 200
    assert Decimal(str(compra_balance.json()["balance"])) == Decimal("-100.0000")


def test_movements_filters_and_pagination(client):
    for idx in range(4):
        _create_movement(
            client,
            {
                "period_id": 7,
                "date": f"2026-02-0{idx + 1}",
                "type": "gasto",
                "amount": "10.0000",
                "description": f"gasto-{idx}",
            },
        )

    filtered = client.get(
        "/api/movements/",
        params={"period_id": 7, "date_from": "2026-02-02", "date_to": "2026-02-03"},
    )
    assert filtered.status_code == 200
    rows = filtered.json()
    assert len(rows) == 2
    assert [row["date"] for row in rows] == ["2026-02-02", "2026-02-03"]

    paged = client.get("/api/movements/", params={"period_id": 7, "limit": 2, "offset": 1})
    assert paged.status_code == 200
    page_rows = paged.json()
    assert len(page_rows) == 2
    assert [row["date"] for row in page_rows] == ["2026-02-02", "2026-02-03"]


def test_entities_alphabetical_and_unique(client):
    _create_movement(
        client,
        {
                "period_id": 10,
                "date": "2026-03-01",
                "type": "venta",
                "amount": "1.0000",
            "description": "venta",
            "items": [
                {
                    "client": "Zulu",
                    "product": "Queso",
                    "quantity": "1.0000",
                    "unit_price": "10.0000",
                    "subtotal": "10.0000",
                },
                {
                    "client": "Alpha",
                    "product": "Azucar",
                    "quantity": "1.0000",
                    "unit_price": "20.0000",
                    "subtotal": "20.0000",
                },
            ],
        },
    )

    _create_movement(
        client,
        {
            "period_id": 10,
            "date": "2026-03-02",
            "type": "sueldo",
            "amount": "1.0000",
            "description": "sueldos",
            "salaries": [{"employee": "Bruno", "subtotal": "30.0000"}, {"employee": "Ana", "subtotal": "40.0000"}],
        },
    )

    entities_resp = client.get("/api/movements/entities")
    assert entities_resp.status_code == 200
    data = entities_resp.json()

    assert data["clients"] == sorted(set(data["clients"]))
    assert data["products"] == sorted(set(data["products"]))
    assert data["employees"] == sorted(set(data["employees"]))
