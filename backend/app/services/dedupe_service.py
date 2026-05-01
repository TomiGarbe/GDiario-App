from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session


@dataclass
class DedupeResult:
    duplicates_found: int
    fk_rows_updated: int
    conflicting_price_rows_deleted: int
    entities_deleted: int


class DedupeService:
    @staticmethod
    def dedupe_clients(db: Session) -> DedupeResult:
        return DedupeService._dedupe_entities(
            db=db,
            table_name="clients",
            fk_updates_sql=[
                "UPDATE movements m SET client_id = d.keep_id FROM dedupe_map d WHERE m.client_id = d.dup_id",
            ],
            price_fk_column="client_id",
        )

    @staticmethod
    def dedupe_products(db: Session) -> DedupeResult:
        return DedupeService._dedupe_entities(
            db=db,
            table_name="products",
            fk_updates_sql=[
                "UPDATE movement_details md SET product_id = d.keep_id FROM dedupe_map d WHERE md.product_id = d.dup_id",
            ],
            price_fk_column="product_id",
        )

    @staticmethod
    def dedupe_employees(db: Session) -> DedupeResult:
        return DedupeService._dedupe_entities(
            db=db,
            table_name="employees",
            fk_updates_sql=[
                "UPDATE movements m SET employee_id = d.keep_id FROM dedupe_map d WHERE m.employee_id = d.dup_id",
                "UPDATE movement_details md SET employee_id = d.keep_id FROM dedupe_map d WHERE md.employee_id = d.dup_id",
            ],
            price_fk_column=None,
        )

    @staticmethod
    def _dedupe_entities(
        db: Session,
        table_name: str,
        fk_updates_sql: list[str],
        price_fk_column: str | None,
    ) -> DedupeResult:
        # Temporary map scoped to the current transaction.
        db.execute(
            text(
                """
                CREATE TEMP TABLE IF NOT EXISTS dedupe_map (
                    dup_id UUID PRIMARY KEY,
                    keep_id UUID NOT NULL
                ) ON COMMIT DROP
                """
            )
        )
        db.execute(text("TRUNCATE TABLE dedupe_map"))

        duplicates_found = db.execute(
            text(
                f"""
                WITH ranked AS (
                    SELECT
                        id,
                        normalized_name,
                        FIRST_VALUE(id) OVER (
                            PARTITION BY normalized_name
                            ORDER BY id::text
                        ) AS keep_id,
                        ROW_NUMBER() OVER (
                            PARTITION BY normalized_name
                            ORDER BY id::text
                        ) AS rn
                    FROM {table_name}
                )
                INSERT INTO dedupe_map (dup_id, keep_id)
                SELECT id, keep_id
                FROM ranked
                WHERE rn > 1
                RETURNING dup_id
                """
            )
        ).rowcount or 0

        if duplicates_found == 0:
            return DedupeResult(
                duplicates_found=0,
                fk_rows_updated=0,
                conflicting_price_rows_deleted=0,
                entities_deleted=0,
            )

        fk_rows_updated = 0
        for update_sql in fk_updates_sql:
            fk_rows_updated += db.execute(text(update_sql)).rowcount or 0

        conflicting_price_rows_deleted = 0
        if price_fk_column is not None:
            if price_fk_column == "client_id":
                conflicting_price_rows_deleted = (
                    db.execute(
                        text(
                            """
                            DELETE FROM prices p
                            USING dedupe_map d
                            WHERE p.client_id = d.dup_id
                              AND EXISTS (
                                SELECT 1
                                FROM prices p2
                                WHERE p2.client_id = d.keep_id
                                  AND p2.product_id = p.product_id
                                  AND p2.start_date = p.start_date
                              )
                            """
                        )
                    ).rowcount
                    or 0
                )
            else:
                conflicting_price_rows_deleted = (
                    db.execute(
                        text(
                            """
                            DELETE FROM prices p
                            USING dedupe_map d
                            WHERE p.product_id = d.dup_id
                              AND EXISTS (
                                SELECT 1
                                FROM prices p2
                                WHERE p2.product_id = d.keep_id
                                  AND p2.client_id = p.client_id
                                  AND p2.start_date = p.start_date
                              )
                            """
                        )
                    ).rowcount
                    or 0
                )
            fk_rows_updated += (
                db.execute(
                    text(
                        f"""
                        UPDATE prices p
                        SET {price_fk_column} = d.keep_id
                        FROM dedupe_map d
                        WHERE p.{price_fk_column} = d.dup_id
                        """
                    )
                ).rowcount
                or 0
            )

        entities_deleted = (
            db.execute(
                text(
                    f"""
                    DELETE FROM {table_name} e
                    USING dedupe_map d
                    WHERE e.id = d.dup_id
                    """
                )
            ).rowcount
            or 0
        )

        db.commit()
        return DedupeResult(
            duplicates_found=duplicates_found,
            fk_rows_updated=fk_rows_updated,
            conflicting_price_rows_deleted=conflicting_price_rows_deleted,
            entities_deleted=entities_deleted,
        )
