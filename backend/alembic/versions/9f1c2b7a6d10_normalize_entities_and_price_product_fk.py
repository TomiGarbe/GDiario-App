"""normalize entities and price product fk

Revision ID: 9f1c2b7a6d10
Revises: 4b3cb42af105
Create Date: 2026-05-01 15:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "9f1c2b7a6d10"
down_revision: Union[str, Sequence[str], None] = "4b3cb42af105"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _set_uuid_defaults() -> None:
    for table in ("clients", "employees", "products", "periods", "movements", "movement_details", "prices"):
        op.alter_column(table, "id", server_default=sa.text("gen_random_uuid()"))


def _remove_duplicate_entities(table: str, ref_updates: list[str]) -> None:
    for update_sql in ref_updates:
        op.execute(update_sql)
    op.execute(
        sa.text(
            f"""
            DELETE FROM {table} t
            USING (
                SELECT id
                FROM (
                    SELECT
                        id,
                        ROW_NUMBER() OVER (
                            PARTITION BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
                            ORDER BY id
                        ) AS rn
                    FROM {table}
                ) s
                WHERE s.rn > 1
            ) d
            WHERE t.id = d.id
            """
        )
    )


def upgrade() -> None:
    op.execute(sa.text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))

    _set_uuid_defaults()

    op.add_column("clients", sa.Column("normalized_name", sa.String(length=120), nullable=True))
    op.add_column("employees", sa.Column("normalized_name", sa.String(length=120), nullable=True))
    op.add_column("products", sa.Column("normalized_name", sa.String(length=120), nullable=True))

    for table in ("clients", "employees", "products"):
        op.execute(
            sa.text(
                f"""
                UPDATE {table}
                SET normalized_name = lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
                WHERE normalized_name IS NULL
                """
            )
        )

    _remove_duplicate_entities(
        table="clients",
        ref_updates=[
            """
            UPDATE movements m
            SET client_id = d.keep_id
            FROM (
                WITH ranked AS (
                    SELECT
                        id,
                        lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) AS normalized_name,
                        FIRST_VALUE(id) OVER (
                            PARTITION BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
                            ORDER BY id::text
                        ) AS keep_id,
                        ROW_NUMBER() OVER (
                            PARTITION BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
                            ORDER BY id::text
                        ) AS rn
                    FROM clients
                )
                SELECT id AS dup_id, keep_id
                FROM ranked
                WHERE rn > 1
            ) d
            WHERE m.client_id = d.dup_id
            """
        ],
    )

    _remove_duplicate_entities(
        table="employees",
        ref_updates=[
            """
            UPDATE movements m
            SET employee_id = d.keep_id
            FROM (
                WITH ranked AS (
                    SELECT
                        id,
                        lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) AS normalized_name,
                        FIRST_VALUE(id) OVER (
                            PARTITION BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
                            ORDER BY id::text
                        ) AS keep_id,
                        ROW_NUMBER() OVER (
                            PARTITION BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
                            ORDER BY id::text
                        ) AS rn
                    FROM employees
                )
                SELECT id AS dup_id, keep_id
                FROM ranked
                WHERE rn > 1
            ) d
            WHERE m.employee_id = d.dup_id
            """,
            """
            UPDATE movement_details md
            SET employee_id = d.keep_id
            FROM (
                WITH ranked AS (
                    SELECT
                        id,
                        lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) AS normalized_name,
                        FIRST_VALUE(id) OVER (
                            PARTITION BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
                            ORDER BY id::text
                        ) AS keep_id,
                        ROW_NUMBER() OVER (
                            PARTITION BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
                            ORDER BY id::text
                        ) AS rn
                    FROM employees
                )
                SELECT id AS dup_id, keep_id
                FROM ranked
                WHERE rn > 1
            ) d
            WHERE md.employee_id = d.dup_id
            """,
        ],
    )

    _remove_duplicate_entities(
        table="products",
        ref_updates=[
            """
            UPDATE movement_details md
            SET product_id = d.keep_id
            FROM (
                WITH ranked AS (
                    SELECT
                        id,
                        lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) AS normalized_name,
                        FIRST_VALUE(id) OVER (
                            PARTITION BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
                            ORDER BY id::text
                        ) AS keep_id,
                        ROW_NUMBER() OVER (
                            PARTITION BY lower(regexp_replace(trim(name), '\\s+', ' ', 'g'))
                            ORDER BY id::text
                        ) AS rn
                    FROM products
                )
                SELECT id AS dup_id, keep_id
                FROM ranked
                WHERE rn > 1
            ) d
            WHERE md.product_id = d.dup_id
            """
        ],
    )

    op.alter_column("clients", "normalized_name", nullable=False)
    op.alter_column("employees", "normalized_name", nullable=False)
    op.alter_column("products", "normalized_name", nullable=False)

    op.create_index("ix_clients_normalized_name", "clients", ["normalized_name"], unique=True)
    op.create_index("ix_employees_normalized_name", "employees", ["normalized_name"], unique=True)
    op.create_index("ix_products_normalized_name", "products", ["normalized_name"], unique=True)

    op.add_column("prices", sa.Column("product_id", sa.UUID(), nullable=True))
    op.create_foreign_key("fk_prices_product_id_products", "prices", "products", ["product_id"], ["id"], ondelete="CASCADE")

    op.execute(
        sa.text(
            """
            INSERT INTO products (name, normalized_name)
            SELECT p.product, lower(regexp_replace(trim(p.product), '\\s+', ' ', 'g'))
            FROM prices p
            LEFT JOIN products prod
              ON prod.normalized_name = lower(regexp_replace(trim(p.product), '\\s+', ' ', 'g'))
            WHERE prod.id IS NULL
            GROUP BY p.product
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE prices p
            SET product_id = prod.id
            FROM products prod
            WHERE prod.normalized_name = lower(regexp_replace(trim(p.product), '\\s+', ' ', 'g'))
            """
        )
    )

    op.alter_column("prices", "product_id", nullable=False)
    op.drop_index("ix_prices_client_product_start_date", table_name="prices")
    op.drop_constraint("uq_prices_client_product_start_date", "prices", type_="unique")
    op.drop_column("prices", "product")
    op.create_unique_constraint(
        "uq_prices_client_product_start_date",
        "prices",
        ["client_id", "product_id", "start_date"],
    )
    op.create_index("ix_prices_client_product_start_date", "prices", ["client_id", "product_id", "start_date"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_prices_client_product_start_date", table_name="prices")
    op.drop_constraint("uq_prices_client_product_start_date", "prices", type_="unique")
    op.add_column("prices", sa.Column("product", sa.String(length=120), nullable=True))
    op.execute(
        sa.text(
            """
            UPDATE prices p
            SET product = prod.name
            FROM products prod
            WHERE p.product_id = prod.id
            """
        )
    )
    op.alter_column("prices", "product", nullable=False)
    op.drop_constraint("fk_prices_product_id_products", "prices", type_="foreignkey")
    op.drop_column("prices", "product_id")
    op.create_unique_constraint(
        "uq_prices_client_product_start_date",
        "prices",
        ["client_id", "product", "start_date"],
    )
    op.create_index("ix_prices_client_product_start_date", "prices", ["client_id", "product", "start_date"], unique=False)

    op.drop_index("ix_products_normalized_name", table_name="products")
    op.drop_index("ix_employees_normalized_name", table_name="employees")
    op.drop_index("ix_clients_normalized_name", table_name="clients")
    op.drop_column("products", "normalized_name")
    op.drop_column("employees", "normalized_name")
    op.drop_column("clients", "normalized_name")
