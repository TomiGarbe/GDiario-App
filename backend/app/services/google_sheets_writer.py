from __future__ import annotations

from functools import lru_cache

from google.oauth2 import service_account
from googleapiclient.discovery import build

from app.core.config import get_settings
from app.models.movement import Movement
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem

SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
DELETE_MOVEMENT_SHEETS = [
    "MOVEMENTS",
    "GRASA",
    "HUESOS",
    "CUENTAS",
    "SUELDOS",
    "GASTOS",
]


@lru_cache(maxsize=1)
def get_sheets_service():
    settings = get_settings()
    credentials_file = settings.google_service_account_file
    print("USANDO CREDENTIALS:", credentials_file)
    if not credentials_file:
        raise RuntimeError(
            "GOOGLE_SERVICE_ACCOUNT_FILE is not set. Define it in backend/.env"
        )

    credentials = service_account.Credentials.from_service_account_file(
        credentials_file,
        scopes=[SHEETS_SCOPE],
    )
    return build("sheets", "v4", credentials=credentials)


def append_movement(sheet_id: str, movement: Movement) -> None:
    service = get_sheets_service()
    values = [[
        str(movement.id),
        movement.type.value,
        str(movement.date),
        float(movement.amount),
        movement.description or "",
    ]]
    print("SHEET_ID:", sheet_id)
    print("APPEND MOVEMENT:", movement.id)
    try:
        result = service.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="MOVEMENTS!A:F",
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()
        print("GOOGLE RESPONSE:", result)
    except Exception as e:
        print("GOOGLE ERROR:", str(e))
        raise


def append_items(sheet_id: str, items: list[MovementItem]) -> None:
    if not items:
        return

    service = get_sheets_service()
    values = [
        [
            str(item.movement_id),
            item.client.name,
            item.product.name,
            float(item.quantity),
            float(item.unit_price),
            float(item.subtotal),
        ]
        for item in items
    ]

    try:
        result = service.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="ITEMS!A:F",
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()
        print("GOOGLE RESPONSE:", result)
    except Exception as e:
        print("GOOGLE ERROR:", str(e))
        raise


def append_client_payments(sheet_id: str, payments: list[MovementClientPayment]) -> None:
    if not payments:
        return

    service = get_sheets_service()
    values = [
        [
            str(payment.movement_id),
            payment.client.name,
            float(payment.subtotal),
        ]
        for payment in payments
    ]

    try:
        result = service.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="CLIENT_PAYMENTS!A:C",
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()
        print("GOOGLE RESPONSE:", result)
    except Exception as e:
        print("GOOGLE ERROR:", str(e))
        raise


def get_sheet_gid(service, sheet_id: str, sheet_name: str) -> int:
    meta = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
    for sheet in meta.get("sheets", []):
        props = sheet.get("properties", {})
        if props.get("title") == sheet_name:
            return int(props["sheetId"])
    raise Exception(f"Sheet not found: {sheet_name}")


def find_rows_by_movement_id(service, sheet_id: str, sheet_name: str, movement_id: str) -> list[int]:
    result = service.spreadsheets().values().get(
        spreadsheetId=sheet_id,
        range=f"{sheet_name}!A:Z",
    ).execute()
    values = result.get("values", [])
    target = str(movement_id).strip()
    rows: list[int] = []
    for i, row in enumerate(values):
        if not row:
            continue
        if str(row[-1]).strip() == target:
            rows.append(i + 1)  # Sheets row index starts at 1
    return rows


def delete_rows(service, sheet_id: str, sheet_name: str, row_indexes: list[int]) -> None:
    if not row_indexes:
        return

    gid = get_sheet_gid(service, sheet_id, sheet_name)
    requests = []
    for row in sorted(row_indexes, reverse=True):
        requests.append(
            {
                "deleteDimension": {
                    "range": {
                        "sheetId": gid,
                        "dimension": "ROWS",
                        "startIndex": row - 1,
                        "endIndex": row,
                    }
                }
            }
        )

    service.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id,
        body={"requests": requests},
    ).execute()


def delete_movement_from_sheets(sheet_id: str, movement_id: str) -> None:
    service = get_sheets_service()
    print(f"[SHEETS DELETE] movement_id={movement_id}")

    for sheet_name in DELETE_MOVEMENT_SHEETS:
        rows = find_rows_by_movement_id(service, sheet_id, sheet_name, movement_id)
        delete_rows(service, sheet_id, sheet_name, rows)


def test_sheets(sheet_id: str) -> None:
    service = get_sheets_service()
    print("TEST SHEETS SHEET_ID:", sheet_id)
    test_values = [["TEST", "debug", "manual"]]
    try:
        result = service.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="MOVEMENTS!A:C",
            valueInputOption="RAW",
            body={"values": test_values},
        ).execute()
        print("GOOGLE RESPONSE:", result)
    except Exception as e:
        print("GOOGLE ERROR:", str(e))
        raise
