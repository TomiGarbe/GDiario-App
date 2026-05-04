from __future__ import annotations

import json
from functools import lru_cache
from datetime import date, datetime

from google.oauth2 import service_account
from googleapiclient.discovery import build

from app.core.config import get_settings
from app.models.movement import Movement
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem

SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
DELETE_MOVEMENT_SHEETS = [
    "MOVEMENTS",
    "ITEMS",
    "SALARIES",
    "CLIENT_PAYMENTS",
    "CUENTAS",
    "SUELDOS",
    "GASTOS",
]
MOVEMENT_ID_COLUMN_BY_SHEET = {
    "MOVEMENTS": 0,
    "ITEMS": 0,
    "SALARIES": 0,
    "CLIENT_PAYMENTS": 0,
    "CUENTAS": 9,
    "SUELDOS": 5,
    "GASTOS": 3,
}


@lru_cache(maxsize=1)
def get_google_credentials():
    settings = get_settings()
    raw = settings.google_credentials_json

    print("==== GOOGLE CREDS DEBUG ====")
    print("TYPE:", type(raw))
    print("LENGTH:", len(raw) if raw else 0)
    print("START:", raw[:200] if raw else None)
    print("============================")

    if not raw:
        raise RuntimeError("GOOGLE_CREDENTIALS_JSON vacio")

    try:
        creds_dict = json.loads(raw)
        print("JSON OK (directo)")
    except Exception as exc:
        print("JSON ERROR (directo):", str(exc))
        try:
            creds_dict = json.loads(json.loads(raw))
            print("JSON OK (doble parseo)")
        except Exception as exc2:
            print("JSON ERROR (doble):", str(exc2))
            raise RuntimeError("Invalid GOOGLE_CREDENTIALS_JSON") from exc2

    return service_account.Credentials.from_service_account_info(
        creds_dict,
        scopes=[SHEETS_SCOPE],
    )


@lru_cache(maxsize=1)
def get_sheets_service():
    credentials = get_google_credentials()
    return build("sheets", "v4", credentials=credentials)


def append_movement(sheet_id: str, movement: Movement) -> None:
    service = get_sheets_service()
    values = [[
        str(movement.id),
        movement.type.value,
        str(movement.date),
        float(movement.amount),
        movement.description or "",
        movement.updated_at.isoformat() if movement.updated_at else "",
        movement.source or "",
    ]]
    try:
        service.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="MOVEMENTS!A:G",
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()
    except Exception as e:
        print(f"[ERROR] {str(e)}")
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
        service.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="ITEMS!A:F",
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        raise


def append_items_to_product_sheets(sheet_id: str, movement: Movement) -> None:
    if not movement.items:
        return

    service = get_sheets_service()
    for item in movement.items:
        product_name = (item.product.name or "").strip().upper()
        if product_name not in {"GRASA", "HUESOS"}:
            continue

        _upsert_product_quantity(
            service=service,
            spreadsheet_id=sheet_id,
            sheet_name=product_name,
            movement_date=movement.date,
            client_name=item.client.name,
            quantity=float(item.quantity),
        )


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
        service.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="CLIENT_PAYMENTS!A:C",
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        raise


def append_client_payments_to_cuentas(sheet_id: str, movement: Movement) -> None:
    if not movement.client_payments:
        return

    service = get_sheets_service()
    for payment in movement.client_payments:
        values = [[
            str(movement.date),
            payment.client.name,
            "Pago de Fabian",
            "",
            "",
            "",
            "",
            "",
            float(payment.subtotal),
            str(movement.id),
        ]]
        service.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="CUENTAS!A:J",
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()


def append_salaries_to_sheet(sheet_id: str, movement: Movement) -> None:
    if not movement.salaries:
        return

    service = get_sheets_service()
    for salary in movement.salaries:
        values = [[
            str(movement.date),
            salary.employee.name,
            "Adelanto",
            "Adelanto",
            float(salary.subtotal),
            str(movement.id),
        ]]
        service.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range="SUELDOS!A:F",
            valueInputOption="USER_ENTERED",
            body={"values": values},
        ).execute()


def append_salaries(sheet_id: str, movement: Movement) -> None:
    append_salaries_to_sheet(sheet_id, movement)


def append_gasto_to_sheet(sheet_id: str, movement: Movement) -> None:
    values = [[
        str(movement.date),
        movement.description or "",
        float(movement.amount),
        str(movement.id),
        True,
    ]]
    service = get_sheets_service()
    service.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range="GASTOS!A:E",
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()


def sync_movement_to_sheets(sheet_id: str, movement: Movement) -> None:
    append_movement(sheet_id, movement)
    append_items(sheet_id, list(movement.items or []))
    append_salaries(sheet_id, movement)
    append_client_payments(sheet_id, list(movement.client_payments or []))

    movement_type = movement.type.value
    if movement_type in ("compra", "venta"):
        append_items_to_product_sheets(sheet_id, movement)
    if movement_type == "pago_cliente":
        append_client_payments_to_cuentas(sheet_id, movement)
    if movement_type == "sueldo":
        append_salaries_to_sheet(sheet_id, movement)
    if movement_type == "gasto":
        append_gasto_to_sheet(sheet_id, movement)


def update_movement_sheets(sheet_id: str, movement: Movement) -> None:
    delete_movement_from_sheets(sheet_id, str(movement.id))
    sync_movement_to_sheets(sheet_id, movement)


def get_sheet_gid(service, sheet_id: str, sheet_name: str) -> int:
    meta = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
    for sheet in meta.get("sheets", []):
        props = sheet.get("properties", {})
        if props.get("title") == sheet_name:
            return int(props["sheetId"])
    raise Exception(f"Sheet not found: {sheet_name}")


def find_rows_by_movement_id(
    service,
    sheet_id: str,
    sheet_name: str,
    movement_id: str,
    id_column_index: int = 0,
) -> list[int]:
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
        if id_column_index >= len(row):
            continue

        row_id = str(row[id_column_index]).strip()

        if row_id == target:
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

    for sheet_name in DELETE_MOVEMENT_SHEETS:
        try:
            id_col = MOVEMENT_ID_COLUMN_BY_SHEET.get(sheet_name, 0)
            rows = find_rows_by_movement_id(service, sheet_id, sheet_name, movement_id, id_col)
            delete_rows(service, sheet_id, sheet_name, rows)
        except Exception as exc:
            print(f"[SHEETS DELETE SKIP] sheet={sheet_name} movement_id={movement_id} error={exc}")


def test_sheets(sheet_id: str) -> None:
    service = get_sheets_service()
    try:
        service.spreadsheets().get(spreadsheetId=sheet_id).execute()
        print("SHEETS OK")
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        raise


def _normalize_date_key(value) -> str:
    if isinstance(value, datetime):
        return value.date().strftime("%d/%m/%Y")
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    text = str(value or "").strip()
    if not text:
        return ""
    if "T" in text:
        text = text.split("T", 1)[0]
    if " " in text:
        text = text.split(" ", 1)[0]

    for pattern in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text, pattern).strftime("%d/%m/%Y")
        except ValueError:
            pass

    return text


def _to_col_letter(col_index_zero_based: int) -> str:
    n = col_index_zero_based + 1
    letters: list[str] = []
    while n > 0:
        n, rem = divmod(n - 1, 26)
        letters.append(chr(65 + rem))
    return "".join(reversed(letters))


def _parse_float(value) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace(",", ".")
    if not text:
        return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _upsert_product_quantity(
    service,
    spreadsheet_id: str,
    sheet_name: str,
    movement_date,
    client_name: str,
    quantity: float,
) -> None:
    result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!A:ZZ",
    ).execute()
    values = result.get("values", [])
    if not values:
        values = [[]]

    header = values[0] if values else []
    target_date = _normalize_date_key(movement_date)

    col_index = None
    for i, cell in enumerate(header):
        if _normalize_date_key(cell) == target_date:
            col_index = i
            break
    if col_index is None:
        print(f"[SHEETS SKIP] Fecha no encontrada: {target_date}")
        return

    rows = values[1:] if len(values) > 1 else []
    target_client = str(client_name or "").strip().lower()
    row_index = None
    for i, row in enumerate(rows, start=2):
        cell = str(row[0]).strip().lower() if row else ""
        if cell == target_client:
            row_index = i
            break
    if row_index is None:
        print(f"[SHEETS SKIP] Cliente no encontrado: {client_name}")
        return

    col_letter = _to_col_letter(col_index)
    cell_result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!{col_letter}{row_index}",
    ).execute()
    current_raw = cell_result.get("values", [[]])[0][0] if cell_result.get("values") else ""
    new_value = _parse_float(current_raw) + float(quantity)

    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!{col_letter}{row_index}",
        valueInputOption="USER_ENTERED",
        body={"values": [[new_value]]},
    ).execute()
