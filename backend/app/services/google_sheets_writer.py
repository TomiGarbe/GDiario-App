from __future__ import annotations

from functools import lru_cache

from google.oauth2 import service_account
from googleapiclient.discovery import build

from app.core.config import get_settings
from app.models.movement import Movement
from app.models.movement_client_payment import MovementClientPayment
from app.models.movement_item import MovementItem

SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"


@lru_cache(maxsize=1)
def get_sheets_service():
    settings = get_settings()
    credentials_file = settings.google_service_account_file
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

    service.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range="MOVEMENTS!A:F",
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()


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

    service.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range="ITEMS!A:F",
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()


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

    service.spreadsheets().values().append(
        spreadsheetId=sheet_id,
        range="CLIENT_PAYMENTS!A:C",
        valueInputOption="USER_ENTERED",
        body={"values": values},
    ).execute()
