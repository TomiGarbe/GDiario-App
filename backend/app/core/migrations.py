from __future__ import annotations

import logging
import os
from pathlib import Path

from alembic import command
from alembic.config import Config

logger = logging.getLogger(__name__)


def run_startup_migrations() -> None:
    if os.getenv("DISABLE_STARTUP_MIGRATIONS", "").strip().lower() in {"1", "true", "yes"}:
        logger.info("Startup migrations disabled")
        return

    backend_dir = Path(__file__).resolve().parents[2]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    logger.info("Running startup database migrations")
    command.upgrade(config, "head")
