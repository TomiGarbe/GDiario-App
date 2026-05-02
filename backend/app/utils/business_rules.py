from __future__ import annotations

from decimal import Decimal

from app.utils.name_normalization import normalize_name

ZERO = Decimal("0")

CLIENTES_SIN_MONTO = {
    "buenos dias",
    "cordiez",
    "mariano",
    "scurti",
    "oviedo",
    "almacor 35",
    "amanecer",
    "marcos",
    "nico",
    "refineria",
}


def es_cliente_sin_monto(nombre: str) -> bool:
    return normalize_name(str(nombre or "")) in CLIENTES_SIN_MONTO


def coerce_zero_if_special_client(
    client_name: str,
    value: Decimal | None,
) -> tuple[Decimal | None, bool]:
    if value is None:
        return None, False
    if es_cliente_sin_monto(client_name):
        return ZERO, value != ZERO
    return value, False
