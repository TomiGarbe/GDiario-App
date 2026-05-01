import os
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

# 👇 importar settings
from app.core.config import get_settings
from app.core.db import Base

# ⚠️ importar modelos (clave para autogenerate)
from app.models import *

# 👇 obtener config de Alembic
config = context.config

# 👇 logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 👇 metadata para autogenerate
target_metadata = Base.metadata

# 👇 obtener DATABASE_URL desde tu Settings
settings = get_settings()
DATABASE_URL = settings.database_url

# 👇 inyectar en Alembic
config.set_main_option("sqlalchemy.url", DATABASE_URL)


def run_migrations_offline():
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")

    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()