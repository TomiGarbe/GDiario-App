from __future__ import annotations

import unicodedata


def normalize_name(name: str) -> str:
    clean = " ".join(name.strip().split()).lower()
    # Remove accents/diacritics for stable lookups.
    normalized = unicodedata.normalize("NFKD", clean)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))
