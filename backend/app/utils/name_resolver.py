from __future__ import annotations

from collections.abc import Iterable
from typing import TypeVar
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

T = TypeVar("T")


def normalize_entity_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


def resolve_or_create_entities(session: Session, model: type[T], names: Iterable[str]) -> dict[str, UUID]:
    normalized_to_name: dict[str, str] = {}
    for raw_name in names:
        clean_name = " ".join(raw_name.strip().split())
        if clean_name:
            normalized_to_name[normalize_entity_name(clean_name)] = clean_name

    if not normalized_to_name:
        return {}

    normalized_keys = list(normalized_to_name.keys())
    existing_entities = (
        session.query(model)
        .filter(func.lower(model.name).in_(normalized_keys))
        .all()
    )

    normalized_to_id: dict[str, UUID] = {
        normalize_entity_name(entity.name): entity.id
        for entity in existing_entities
    }

    missing_names = [
        clean_name
        for normalized_name, clean_name in normalized_to_name.items()
        if normalized_name not in normalized_to_id
    ]

    if missing_names:
        session.bulk_save_objects([model(name=name) for name in missing_names])
        session.flush()

        refreshed_entities = (
            session.query(model)
            .filter(func.lower(model.name).in_(normalized_keys))
            .all()
        )
        normalized_to_id = {
            normalize_entity_name(entity.name): entity.id
            for entity in refreshed_entities
        }

    return normalized_to_id
