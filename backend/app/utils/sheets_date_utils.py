from __future__ import annotations

from datetime import date, datetime
import logging
import re

logger = logging.getLogger(__name__)

_DD_MM_YYYY_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})$")
_DD_MM_YY_RE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{2})$")


def parse_sheet_date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    text = str(value or "").strip()
    if not text:
        return None

    if "T" in text:
        text = text.split("T", 1)[0]
    if " " in text:
        text = text.split(" ", 1)[0]

    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        pass

    match_yyyy = _DD_MM_YYYY_RE.match(text)
    if match_yyyy:
        day, month, year = (int(part) for part in match_yyyy.groups())
        try:
            return date(year, month, day)
        except ValueError:
            logger.warning("[SHEETS DATE] Invalid dd/mm/yyyy date: raw=%r", value)
            return None

    match_yy = _DD_MM_YY_RE.match(text)
    if match_yy:
        day, month, yy = (int(part) for part in match_yy.groups())
        year = 2000 + yy
        try:
            return date(year, month, day)
        except ValueError:
            logger.warning("[SHEETS DATE] Invalid dd/mm/yy date: raw=%r interpreted_year=%s", value, year)
            return None

    logger.warning("[SHEETS DATE] Unsupported date format: raw=%r", value)
    return None


def normalize_sheet_date_key(value) -> str:
    parsed = parse_sheet_date(value)
    if parsed is None:
        return ""
    return parsed.strftime("%d/%m/%Y")


def normalize_sheet_day_month_key(value) -> str:
    parsed = parse_sheet_date(value)
    if parsed is None:
        return ""
    return parsed.strftime("%d/%m")
