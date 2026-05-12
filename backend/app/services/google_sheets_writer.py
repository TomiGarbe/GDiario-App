from __future__ import annotations

import json
from functools import lru_cache
from datetime import date
from decimal import Decimal
import logging
import unicodedata
from uuid import UUID

from sqlalchemy import func, select

from google.oauth2 import service_account
from googleapiclient.discovery import build

from app.core.db import SessionLocal
from app.core.config import get_settings
from app.models.client import Client
from app.models.movement import Movement
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem
from app.models.product import Product
from app.utils.sheets_date_utils import normalize_sheet_date_key, normalize_sheet_day_month_key

logger = logging.getLogger(__name__)

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
        logger.info(
            "[SHEETS PRODUCT] movement_id=%s type=%s items=0 (skip)",
            movement.id,
            _movement_type_key(movement),
        )
        return

    service = get_sheets_service()
    touched: set[tuple[date, str, str]] = set()
    logger.info(
        "[SHEETS PRODUCT] movement_id=%s type=%s items=%s",
        movement.id,
        _movement_type_key(movement),
        len(movement.items or []),
    )
    for item in movement.items:
        product_name = str(item.product.name or "").strip()
        target_sheet = _sheet_name_for_product(product_name)
        logger.info(
            "[SHEETS PRODUCT] resolve movement_id=%s client=%s product=%s target_sheet=%s date=%s",
            movement.id,
            item.client.name,
            product_name,
            target_sheet,
            movement.date,
        )
        if target_sheet is None:
            continue
        touched.add((movement.date, item.client.name, product_name))
    for movement_date, client_name, product_name in touched:
        sheet_name = _sheet_name_for_product(product_name)
        if sheet_name is None:
            continue
        try:
            _recalculate_product_quantity(
                service=service,
                spreadsheet_id=sheet_id,
                sheet_name=sheet_name,
                movement_date=movement_date,
                client_name=client_name,
                product_name=product_name,
                period_id=movement.period_id,
            )
        except Exception:
            logger.exception(
                "[SHEETS PRODUCT] failed movement_id=%s date=%s client=%s product=%s sheet=%s",
                movement.id,
                movement_date,
                client_name,
                product_name,
                sheet_name,
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
        clientName = _normalize_name(payment.client.name)
        values = [[
            str(movement.date),
            clientName,
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


def _movement_type_key(movement: Movement) -> str:
    raw_type = getattr(movement.type, "value", movement.type)
    return str(raw_type or "").strip().lower()


def _normalize_name(value: str | None) -> str:
    return str(value or "").strip().upper()


def _extract_salary_employee_name(salary) -> str:
    employee = getattr(salary, "employee", "")
    if isinstance(employee, str):
        return employee
    return str(getattr(employee, "name", ""))


def _extract_salary_amount(salary) -> float:
    return float(getattr(salary, "subtotal", 0) or 0)


def _update_sheet_row(service, sheet_id: str, sheet_name: str, row_index: int, row_values: list[object]) -> None:
    end_col = _to_col_letter(len(row_values) - 1)
    service.spreadsheets().values().update(
        spreadsheetId=sheet_id,
        range=f"{sheet_name}!A{row_index}:{end_col}{row_index}",
        valueInputOption="USER_ENTERED",
        body={"values": [row_values]},
    ).execute()


def _append_sheet_row(service, sheet_id: str, sheet_name: str, row_values: list[object]) -> None:
    end_col = _to_col_letter(len(row_values) - 1)
    service.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range=f"{sheet_name}!A:{end_col}",
        valueInputOption="USER_ENTERED",
        body={"values": [row_values]},
    ).execute()


def _upsert_salary_row(
    service,
    sheet_id: str,
    sheet_name: str,
    row_values: list[object],
    movement_id: str,
    employee_name: str,
    movement_id_column_index: int,
    employee_column_index: int,
) -> None:
    matches = find_rows_by_movement_id_and_employee(
        service=service,
        sheet_id=sheet_id,
        sheet_name=sheet_name,
        movement_id=movement_id,
        employee_name=employee_name,
        movement_id_column_index=movement_id_column_index,
        employee_column_index=employee_column_index,
    )
    if matches:
        _update_sheet_row(service, sheet_id, sheet_name, matches[0], row_values)
        if len(matches) > 1:
            delete_rows(service, sheet_id, sheet_name, matches[1:])
        return
    _append_sheet_row(service, sheet_id, sheet_name, row_values)


def append_salary_detail_to_salaries(sheet_id: str, movement: Movement, salary) -> None:
    employee = _normalize_name(_extract_salary_employee_name(salary))
    if not employee:
        return

    service = get_sheets_service()
    movement_id = str(movement.id).strip()
    salary_amount = _extract_salary_amount(salary)
    salary_date = str(movement.date)
    print("WRITE SALARY → SALARIES", movement.id, employee)
    _upsert_salary_row(
        service=service,
        sheet_id=sheet_id,
        sheet_name="SALARIES",
        row_values=[
            movement_id,
            employee,
            salary_amount,
            salary_date,
        ],
        movement_id=movement_id,
        employee_name=employee,
        movement_id_column_index=0,
        employee_column_index=1,
    )


def append_salary_summary_to_sueldos(sheet_id: str, movement: Movement, salary) -> None:
    employee = _normalize_name(_extract_salary_employee_name(salary))
    if not employee:
        return

    service = get_sheets_service()
    movement_id = str(movement.id).strip()
    salary_amount = _extract_salary_amount(salary)
    salary_date = str(movement.date)
    print("WRITE SALARY → SUELDOS", movement.id, employee)
    _upsert_salary_row(
        service=service,
        sheet_id=sheet_id,
        sheet_name="SUELDOS",
        row_values=[
            salary_date,
            employee,
            "Adelanto",
            "Adelanto",
            salary_amount,
            movement_id,
        ],
        movement_id=movement_id,
        employee_name=employee,
        movement_id_column_index=5,
        employee_column_index=1,
    )


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
    for salary in movement.salaries or []:
        append_salary_detail_to_salaries(sheet_id, movement, salary)
        append_salary_summary_to_sueldos(sheet_id, movement, salary)
    append_client_payments(sheet_id, list(movement.client_payments or []))

    movement_type = _movement_type_key(movement)
    if movement_type in ("compra", "venta"):
        append_items_to_product_sheets(sheet_id, movement)
    if movement_type == "pago_cliente":
        append_client_payments_to_cuentas(sheet_id, movement)
    if movement_type == "gasto":
        append_gasto_to_sheet(sheet_id, movement)


def update_movement_sheets(
    sheet_id: str,
    movement: Movement,
    previous_product_cells: set[tuple[date, str, str]] | None = None,
) -> None:
    delete_movement_from_sheets(
        sheet_id,
        str(movement.id),
        recalculate_product_cells=previous_product_cells,
    )
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


def find_rows_by_movement_id_and_employee(
    service,
    sheet_id: str,
    sheet_name: str,
    movement_id: str,
    employee_name: str,
    movement_id_column_index: int,
    employee_column_index: int,
) -> list[int]:
    result = service.spreadsheets().values().get(
        spreadsheetId=sheet_id,
        range=f"{sheet_name}!A:Z",
    ).execute()
    values = result.get("values", [])
    target_movement_id = str(movement_id).strip()
    target_employee = _normalize_name(employee_name)
    rows: list[int] = []

    for i, row in enumerate(values):
        if not row:
            continue
        if movement_id_column_index >= len(row):
            continue

        row_movement_id = str(row[movement_id_column_index]).strip()
        row_employee = (
            _normalize_name(row[employee_column_index])
            if employee_column_index < len(row)
            else ""
        )

        if row_movement_id == target_movement_id and row_employee == target_employee:
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


def delete_movement_from_sheets(
    sheet_id: str,
    movement_id: str,
    recalculate_product_cells: set[tuple[date, str, str]] | None = None,
) -> None:
    service = get_sheets_service()

    for sheet_name in DELETE_MOVEMENT_SHEETS:
        try:
            id_col = MOVEMENT_ID_COLUMN_BY_SHEET.get(sheet_name, 0)
            rows = find_rows_by_movement_id(service, sheet_id, sheet_name, movement_id, id_col)
            delete_rows(service, sheet_id, sheet_name, rows)
        except Exception as exc:
            print(f"[SHEETS DELETE SKIP] sheet={sheet_name} movement_id={movement_id} error={exc}")

    touched = recalculate_product_cells or _load_product_cells_for_movement(UUID(movement_id))
    period_id = _load_period_id_for_movement(UUID(movement_id))
    if period_id is None:
        return
    for movement_date, client_name, product_name in touched:
        sheet_name = _sheet_name_for_product(product_name)
        if sheet_name is None:
            continue
        _recalculate_product_quantity(
            service=service,
            spreadsheet_id=sheet_id,
            sheet_name=sheet_name,
            movement_date=movement_date,
            client_name=client_name,
            product_name=product_name,
            period_id=period_id,
        )


def test_sheets(sheet_id: str) -> None:
    service = get_sheets_service()
    try:
        service.spreadsheets().get(spreadsheetId=sheet_id).execute()
        print("SHEETS OK")
    except Exception as e:
        print(f"[ERROR] {str(e)}")
        raise


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


def _recalculate_product_quantity(
    service,
    spreadsheet_id: str,
    sheet_name: str,
    movement_date,
    client_name: str,
    product_name: str,
    period_id: int,
) -> None:
    logger.info(
        "[SHEETS PRODUCT] recalc start sheet=%s date=%s client=%s product=%s period_id=%s",
        sheet_name,
        movement_date,
        client_name,
        product_name,
        period_id,
    )
    result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!A:ZZ",
    ).execute()
    values = result.get("values", [])
    if not values:
        values = [[]]

    header = values[0] if values else []
    target_date = normalize_sheet_date_key(movement_date)
    if not target_date:
        logger.warning(
            "[SHEETS SKIP] Invalid movement_date while recalculating: raw=%r (sheet=%s client=%s product=%s)",
            movement_date,
            sheet_name,
            client_name,
            product_name,
        )
        return

    col_index = None
    for i, cell in enumerate(header):
        normalized_cell_date = normalize_sheet_date_key(cell)
        if not normalized_cell_date and str(cell or "").strip():
            logger.warning(
                "[SHEETS DATE] Header cell has invalid date format: sheet=%s col=%s raw=%r",
                sheet_name,
                i,
                cell,
            )
        if normalized_cell_date == target_date:
            col_index = i
            break
    if col_index is None:
        target_day_month = normalize_sheet_day_month_key(movement_date)
        for i, cell in enumerate(header):
            if normalize_sheet_day_month_key(cell) == target_day_month:
                col_index = i
                logger.info(
                    "[SHEETS PRODUCT] date fallback matched sheet=%s target=%s header_cell=%s col_index=%s",
                    sheet_name,
                    target_day_month,
                    cell,
                    i,
                )
                break
    if col_index is None:
        logger.warning("[SHEETS SKIP] Fecha no encontrada: %s (sheet=%s)", target_date, sheet_name)
        return

    rows = values[1:] if len(values) > 1 else []
    row_index = _find_row_by_client_and_product(
        rows=rows,
        client_name=client_name,
        product_name=product_name,
        sheet_name=sheet_name,
    )
    if row_index is None:
        logger.warning(
            "[SHEETS SKIP] Cliente no encontrado: %s (producto=%s, sheet=%s)",
            client_name,
            product_name,
            sheet_name,
        )
        return

    col_letter = _to_col_letter(col_index)
    total_quantity = _sum_active_quantity_from_db(
        period_id=period_id,
        movement_date=movement_date,
        client_name=client_name,
        product_name=product_name,
    )
    logger.info(
        "[SHEETS PRODUCT] recalc resolved sheet=%s cell=%s row=%s total=%s",
        sheet_name,
        col_letter,
        row_index,
        total_quantity,
    )

    cell_ref = f"{sheet_name}!{col_letter}{row_index}"
    if total_quantity == Decimal("0"):
        service.spreadsheets().values().clear(
            spreadsheetId=spreadsheet_id,
            range=cell_ref,
            body={},
        ).execute()
        return

    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=cell_ref,
        valueInputOption="USER_ENTERED",
        body={"values": [[float(total_quantity)]]},
    ).execute()


def _sum_active_quantity_from_db(
    *,
    period_id: int,
    movement_date,
    client_name: str,
    product_name: str,
) -> Decimal:
    db = SessionLocal()
    try:
        normalized_client = str(client_name or "").strip().lower()
        normalized_product = _normalize_huesos_variant(product_name)
        base_query = (
            select(func.coalesce(func.sum(MovementItem.quantity), 0))
            .select_from(MovementItem)
            .join(Movement, Movement.id == MovementItem.movement_id)
            .join(Client, Client.id == MovementItem.client_id)
            .join(Product, Product.id == MovementItem.product_id)
            .where(
                Movement.deleted_at.is_(None),
                Movement.period_id == period_id,
                Movement.date == movement_date,
                func.lower(func.trim(Client.name)) == normalized_client,
            )
        )

        if normalized_product == "grasa":
            product_filter = func.lower(func.trim(Product.name)) == "grasa"
        elif normalized_product == "aserrin":
            product_filter = func.lower(func.trim(Product.name)).contains("aserrin")
        elif normalized_product == "huesos":
            product_filter = func.lower(func.trim(Product.name)).contains("hueso")
        else:
            product_filter = func.lower(func.trim(Product.name)) == str(product_name or "").strip().lower()

        total = db.execute(base_query.where(product_filter)).scalar_one()
        return Decimal(total or 0)
    finally:
        db.close()


def _normalize_product_key(product_name: str | None) -> str:
    text = str(product_name or "").strip().lower()
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(char for char in normalized if not unicodedata.combining(char))


def _normalize_huesos_variant(product_name: str | None) -> str:
    normalized = _normalize_product_key(product_name)
    if "aserrin" in normalized:
        return "aserrin"
    if "hueso" in normalized:
        return "huesos"
    return normalized


def _sheet_name_for_product(product_name: str) -> str | None:
    normalized = _normalize_huesos_variant(product_name)
    if normalized == "grasa":
        return "GRASA"
    if normalized in {"huesos", "aserrin"}:
        return "HUESOS"
    return None


def _find_all_rows_by_client(rows: list[list[object]], client_name: str) -> list[int]:
    target_client = _normalize_product_key(client_name)
    matches: list[int] = []
    for i, row in enumerate(rows, start=2):
        cell = _normalize_product_key(row[0] if row else "")
        if cell == target_client:
            matches.append(i)
    return matches


def _find_row_by_client(rows: list[list[object]], client_name: str) -> int | None:
    matches = _find_all_rows_by_client(rows, client_name)
    return matches[0] if matches else None


def _find_row_by_client_and_product(
    rows: list[list[object]],
    client_name: str,
    product_name: str | None,
    sheet_name: str,
) -> int | None:
    target_client = _normalize_product_key(client_name)
    if sheet_name == "HUESOS" and target_client == "cordiez":
        matches = _find_all_rows_by_client(rows, client_name)
        if len(matches) < 2:
            print("[SHEETS SKIP] CORDIEZ requiere 2 filas en HUESOS")
            return None

        target_product = _normalize_huesos_variant(product_name)
        if target_product == "aserrin":
            row = matches[0]
            print("CORDIEZ WRITE:", target_product, "\u2192 row", row)
            return row
        if target_product == "huesos":
            row = matches[1]
            print("CORDIEZ WRITE:", target_product, "\u2192 row", row)
            return row

    return _find_row_by_client(rows, client_name)


def _load_product_cells_for_movement(movement_id: UUID) -> set[tuple[date, str, str]]:
    db = SessionLocal()
    try:
        rows = db.execute(
            select(Movement.date, Client.name, Product.name)
            .select_from(MovementItem)
            .join(Movement, Movement.id == MovementItem.movement_id)
            .join(Client, Client.id == MovementItem.client_id)
            .join(Product, Product.id == MovementItem.product_id)
            .where(MovementItem.movement_id == movement_id)
        ).all()
        return {
            (movement_date, client_name, str(product_name or "").strip().upper())
            for movement_date, client_name, product_name in rows
        }
    finally:
        db.close()


def _load_period_id_for_movement(movement_id: UUID) -> int | None:
    db = SessionLocal()
    try:
        return db.execute(select(Movement.period_id).where(Movement.id == movement_id)).scalar_one_or_none()
    finally:
        db.close()
