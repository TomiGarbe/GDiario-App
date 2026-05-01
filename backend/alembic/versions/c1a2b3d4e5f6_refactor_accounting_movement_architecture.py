"""refactor accounting movement architecture

Revision ID: c1a2b3d4e5f6
Revises: 9f1c2b7a6d10
Create Date: 2026-05-01 16:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c1a2b3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "9f1c2b7a6d10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


movement_type_enum = sa.Enum("compra", "venta", "gasto", "sueldo", name="movement_type")


def upgrade() -> None:
    op.execute(sa.text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))

    bind = op.get_bind()
    movement_type_enum.create(bind, checkfirst=True)

    # Enforce case-insensitive uniqueness by canonicalizing and deduplicating names.
    for table in ("clients", "products", "employees"):
        op.execute(
            sa.text(
                f"""
                UPDATE {table}
                SET name = trim(regexp_replace(name, '\\s+', ' ', 'g'))
                WHERE name IS NOT NULL
                """
            )
        )

    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id,
                       lower(name) AS key_name,
                       FIRST_VALUE(id) OVER (PARTITION BY lower(name) ORDER BY id::text) AS keep_id,
                       ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY id::text) AS rn
                FROM clients
            )
            UPDATE movements m
            SET client_id = r.keep_id
            FROM ranked r
            WHERE m.client_id = r.id AND r.rn > 1
            """
        )
    )

    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id,
                       lower(name) AS key_name,
                       FIRST_VALUE(id) OVER (PARTITION BY lower(name) ORDER BY id::text) AS keep_id,
                       ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY id::text) AS rn
                FROM products
            )
            UPDATE movement_details md
            SET product_id = r.keep_id
            FROM ranked r
            WHERE md.product_id = r.id AND r.rn > 1
            """
        )
    )

    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id,
                       lower(name) AS key_name,
                       FIRST_VALUE(id) OVER (PARTITION BY lower(name) ORDER BY id::text) AS keep_id,
                       ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY id::text) AS rn
                FROM employees
            )
            UPDATE movements m
            SET employee_id = r.keep_id
            FROM ranked r
            WHERE m.employee_id = r.id AND r.rn > 1
            """
        )
    )

    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id,
                       lower(name) AS key_name,
                       FIRST_VALUE(id) OVER (PARTITION BY lower(name) ORDER BY id::text) AS keep_id,
                       ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY id::text) AS rn
                FROM employees
            )
            UPDATE movement_details md
            SET employee_id = r.keep_id
            FROM ranked r
            WHERE md.employee_id = r.id AND r.rn > 1
            """
        )
    )

    for table in ("clients", "products", "employees"):
        op.execute(
            sa.text(
                f"""
                DELETE FROM {table} t
                USING (
                    SELECT id
                    FROM (
                        SELECT id,
                               ROW_NUMBER() OVER (PARTITION BY lower(name) ORDER BY id::text) AS rn
                        FROM {table}
                    ) s
                    WHERE s.rn > 1
                ) d
                WHERE t.id = d.id
                """
            )
        )

    op.execute("DROP INDEX IF EXISTS ix_clients_name")
    op.execute("DROP INDEX IF EXISTS ix_products_name")
    op.execute("DROP INDEX IF EXISTS ix_employees_name")
    op.execute("DROP INDEX IF EXISTS ix_clients_normalized_name")
    op.execute("DROP INDEX IF EXISTS ix_products_normalized_name")
    op.execute("DROP INDEX IF EXISTS ix_employees_normalized_name")

    op.execute("ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_name_key")
    op.execute("ALTER TABLE products DROP CONSTRAINT IF EXISTS products_name_key")
    op.execute("ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_name_key")

    op.execute("ALTER TABLE clients DROP COLUMN IF EXISTS normalized_name")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS normalized_name")
    op.execute("ALTER TABLE employees DROP COLUMN IF EXISTS normalized_name")

    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_name_ci ON clients (lower(name))")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_products_name_ci ON products (lower(name))")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_name_ci ON employees (lower(name))")
    op.execute("CREATE INDEX IF NOT EXISTS ix_clients_name ON clients (name)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_products_name ON products (name)")

    op.execute("ALTER TABLE movements DROP CONSTRAINT IF EXISTS ck_movements_type")
    op.execute("ALTER TABLE movements DROP CONSTRAINT IF EXISTS ck_movements_source")

    op.execute("UPDATE movements SET type = 'gasto' WHERE type = 'pago'")

    op.execute(
        """
        ALTER TABLE movements
        ALTER COLUMN type TYPE movement_type
        USING type::movement_type
        """
    )

    op.alter_column("movements", "amount", type_=sa.Numeric(14, 4), existing_type=sa.Numeric(14, 2), existing_nullable=False)
    op.alter_column("movements", "description", type_=sa.Text(), existing_type=sa.String(length=500), existing_nullable=True)
    op.add_column("movements", sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")))

    op.create_table(
        "movement_items",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("movement_id", sa.UUID(), nullable=False),
        sa.Column("client_id", sa.UUID(), nullable=False),
        sa.Column("product_id", sa.UUID(), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_price", sa.Numeric(14, 4), nullable=False),
        sa.Column("subtotal", sa.Numeric(14, 4), nullable=False),
        sa.ForeignKeyConstraint(["movement_id"], ["movements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_movement_items_movement_id", "movement_items", ["movement_id"], unique=False)
    op.create_index("ix_movement_items_client_id", "movement_items", ["client_id"], unique=False)
    op.create_index("ix_movement_items_product_id", "movement_items", ["product_id"], unique=False)

    op.create_table(
        "movement_salaries",
        sa.Column("id", sa.UUID(), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("movement_id", sa.UUID(), nullable=False),
        sa.Column("employee_id", sa.UUID(), nullable=False),
        sa.Column("subtotal", sa.Numeric(14, 4), nullable=False),
        sa.ForeignKeyConstraint(["movement_id"], ["movements.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_movement_salaries_movement_id", "movement_salaries", ["movement_id"], unique=False)
    op.create_index("ix_movement_salaries_employee_id", "movement_salaries", ["employee_id"], unique=False)

    op.execute(
        sa.text(
            """
            INSERT INTO movement_items (movement_id, client_id, product_id, quantity, unit_price, subtotal)
            SELECT md.movement_id,
                   m.client_id,
                   md.product_id,
                   COALESCE(md.quantity, 0),
                   COALESCE(md.unit_price, 0),
                   COALESCE(md.subtotal, 0)
            FROM movement_details md
            JOIN movements m ON m.id = md.movement_id
            WHERE md.product_id IS NOT NULL
              AND m.client_id IS NOT NULL
            """
        )
    )

    op.execute(
        sa.text(
            """
            INSERT INTO movement_salaries (movement_id, employee_id, subtotal)
            SELECT md.movement_id,
                   md.employee_id,
                   COALESCE(md.subtotal, 0)
            FROM movement_details md
            WHERE md.employee_id IS NOT NULL
            """
        )
    )

    op.drop_index("ix_movement_details_type", table_name="movement_details")
    op.drop_index("ix_movement_details_product_id", table_name="movement_details")
    op.drop_index("ix_movement_details_movement_id", table_name="movement_details")
    op.drop_index("ix_movement_details_employee_id", table_name="movement_details")
    op.drop_table("movement_details")

    op.drop_index("ix_movements_client_id", table_name="movements")
    op.drop_index("ix_movements_employee_id", table_name="movements")
    op.drop_column("movements", "client_id")
    op.drop_column("movements", "employee_id")
    op.drop_column("movements", "source")
    op.drop_column("movements", "sheet_id")
    op.drop_column("movements", "sheet_tab")
    op.drop_column("movements", "row_number")


def downgrade() -> None:
    raise NotImplementedError("Downgrade is not supported for this structural refactor")
