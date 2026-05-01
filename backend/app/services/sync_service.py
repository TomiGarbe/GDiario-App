from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID
from uuid import uuid4

from sqlalchemy import func
from sqlalchemy import insert
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.client import Client
from app.models.employee import Employee
from app.models.movement import Movement
from app.models.movement_detail import MovementDetail
from app.models.period import Period
from app.models.price import Price
from app.models.product import Product
from app.schemas.sync import SyncImportErrorItem, SyncImportRequest, SyncImportResponse
from app.schemas.sync import (
    SyncExportMovementDetailItem,
    SyncExportMovementItem,
    SyncExportResponse,
)


class SyncImportError(Exception):
    pass


class SyncService:
    @staticmethod
    def export_data(db: Session) -> SyncExportResponse:
        movement_rows = (
            db.query(
                Movement.id,
                Movement.date,
                Movement.type,
                Client.name.label("client"),
                Employee.name.label("employee"),
                Movement.amount,
                Movement.description,
                Movement.source,
            )
            .outerjoin(Client, Movement.client_id == Client.id)
            .outerjoin(Employee, Movement.employee_id == Employee.id)
            .order_by(Movement.date.asc(), Movement.id.asc())
            .all()
        )

        detail_rows = (
            db.query(
                MovementDetail.id,
                MovementDetail.movement_id,
                MovementDetail.type,
                Product.name.label("product"),
                Employee.name.label("employee"),
                MovementDetail.quantity,
                MovementDetail.unit_price,
                MovementDetail.subtotal,
            )
            .outerjoin(Product, MovementDetail.product_id == Product.id)
            .outerjoin(Employee, MovementDetail.employee_id == Employee.id)
            .order_by(MovementDetail.movement_id.asc(), MovementDetail.id.asc())
            .all()
        )

        movements = [
            SyncExportMovementItem(
                id=row.id,
                date=row.date,
                type=row.type,
                client=row.client,
                employee=row.employee,
                amount=row.amount,
                description=row.description,
                source=row.source,
            )
            for row in movement_rows
        ]
        movement_details = [
            SyncExportMovementDetailItem(
                id=row.id,
                movement_id=row.movement_id,
                type=row.type,
                product=row.product,
                employee=row.employee,
                quantity=row.quantity,
                unit_price=row.unit_price,
                subtotal=row.subtotal,
            )
            for row in detail_rows
        ]

        return SyncExportResponse(movements=movements, movement_details=movement_details)

    @staticmethod
    def sync_period(db: Session, period_data, sheet_id: str) -> tuple[Period, bool]:
        period, created = SyncService._get_or_create_period(db=db, period_data=period_data, sheet_id=sheet_id)
        return period, created

    @staticmethod
    def ensure_clients(db: Session, names: Iterable[str]) -> tuple[int, int, dict[str, UUID]]:
        normalized_to_clean = SyncService._clean_names_map(names)
        if not normalized_to_clean:
            return 0, 0, {}

        normalized_to_id, created = SyncService._get_or_create_entities_map(
            db=db,
            model=Client,
            normalized_to_clean=normalized_to_clean,
        )
        return len(normalized_to_clean), created, normalized_to_id

    @staticmethod
    def upsert_prices(db: Session, prices: Iterable, client_name_to_id: dict[str, UUID] | None = None) -> tuple[int, int]:
        price_items = list(prices)
        if not price_items:
            return 0, 0

        if client_name_to_id is None:
            client_normalized_to_clean = SyncService._clean_names_map(item.client for item in price_items if item.client)
            client_name_to_id, _ = SyncService._get_or_create_entities_map(
                db=db,
                model=Client,
                normalized_to_clean=client_normalized_to_clean,
            )

        rows = SyncService._build_price_rows(price_items, client_name_to_id)
        if rows:
            stmt = pg_insert(Price).values(rows)
            db.execute(
                stmt.on_conflict_do_update(
                    constraint="uq_prices_client_product_start_date",
                    set_={"price": stmt.excluded.price},
                )
            )
        return len(price_items), len(rows)

    @staticmethod
    def insert_movements(
        db: Session,
        period_id: UUID,
        movements: Iterable,
        is_first_batch: bool,
    ) -> tuple[int, int, int]:
        deleted_count = 0
        if is_first_batch:
            deleted_count = (
                db.query(Movement)
                .filter(Movement.period_id == period_id, Movement.source == "sheet")
                .delete(synchronize_session=False)
            )

        movement_items = list(movements)
        if not movement_items:
            return 0, 0, deleted_count

        movement_rows: list[dict] = []
        detail_rows: list[dict] = []
        for item in movement_items:
            movement_id = uuid4()
            movement_rows.append(
                {
                    "id": movement_id,
                    "period_id": period_id,
                    "date": item.date,
                    "type": item.type,
                    "client_id": item.client_id,
                    "employee_id": item.employee_id,
                    "amount": item.amount,
                    "description": item.description,
                    "source": "sheet",
                    "sheet_id": item.sheet_id,
                    "sheet_tab": item.sheet_tab,
                    "row_number": item.row_number,
                }
            )

            for detail in item.details:
                detail_rows.append(
                    {
                        "id": uuid4(),
                        "movement_id": movement_id,
                        "type": detail.type,
                        "product_id": detail.product_id,
                        "employee_id": detail.employee_id,
                        "quantity": detail.quantity,
                        "unit_price": detail.unit_price,
                        "subtotal": detail.subtotal,
                    }
                )

        if movement_rows:
            db.execute(insert(Movement), movement_rows)
        if detail_rows:
            db.execute(insert(MovementDetail), detail_rows)

        return len(movement_items), len(movement_rows), deleted_count

    @staticmethod
    def import_sheet(db: Session, data: SyncImportRequest) -> SyncImportResponse:
        errors: list[SyncImportErrorItem] = []
        imported_count = 0

        try:
            period, _ = SyncService.sync_period(db=db, period_data=data.period, sheet_id=data.sheet_id)

            all_client_names = {m.client for m in data.movements if m.client}
            all_client_names.update(p.client for p in data.prices if p.client)
            _, _, client_name_to_id = SyncService.ensure_clients(db=db, names=all_client_names)

            employee_name_to_id, _ = SyncService._get_or_create_entities_map(
                db=db,
                model=Employee,
                normalized_to_clean=SyncService._clean_names_map(
                    name
                    for movement in data.movements
                    for name in [movement.employee, *(d.employee for d in movement.details if d.employee)]
                    if name
                ),
            )
            product_name_to_id, _ = SyncService._get_or_create_entities_map(
                db=db,
                model=Product,
                normalized_to_clean=SyncService._clean_names_map(
                    d.product
                    for movement in data.movements
                    for d in movement.details
                    if d.product
                ),
            )

            SyncService.upsert_prices(db=db, prices=data.prices, client_name_to_id=client_name_to_id)

            movement_rows: list[dict] = []
            all_detail_rows: list[dict] = []
            deleted_count = 0
            if data.is_first_batch:
                deleted_count = (
                    db.query(Movement)
                    .filter(Movement.period_id == period.id, Movement.source == "sheet")
                    .delete(synchronize_session=False)
                )

            for index, movement_data in enumerate(data.movements, start=1):
                movement_id = uuid4()
                try:
                    movement_rows.append(
                        {
                            "id": movement_id,
                            "period_id": period.id,
                            "date": movement_data.date,
                            "type": movement_data.type,
                            "client_id": (
                                client_name_to_id.get(SyncService._normalize_name(movement_data.client))
                                if movement_data.client
                                else None
                            ),
                            "employee_id": (
                                employee_name_to_id.get(SyncService._normalize_name(movement_data.employee))
                                if movement_data.employee
                                else None
                            ),
                            "amount": movement_data.amount,
                            "description": movement_data.description,
                            "source": "sheet",
                            "sheet_id": data.sheet_id,
                        }
                    )

                    for detail_data in movement_data.details:
                        product_id = None
                        employee_id = None

                        if detail_data.type == "producto":
                            if not detail_data.product:
                                raise SyncImportError("detail.product is required when detail.type='producto'")
                            product_id = product_name_to_id.get(SyncService._normalize_name(detail_data.product))

                        if detail_data.type == "empleado":
                            employee_name = detail_data.employee or movement_data.employee
                            if not employee_name:
                                raise SyncImportError(
                                    "detail.employee or movement.employee is required when detail.type='empleado'"
                                )
                            employee_id = employee_name_to_id.get(SyncService._normalize_name(employee_name))

                        all_detail_rows.append(
                            {
                                "id": uuid4(),
                                "movement_id": movement_id,
                                "type": detail_data.type,
                                "product_id": product_id,
                                "employee_id": employee_id,
                                "quantity": detail_data.quantity,
                                "unit_price": detail_data.unit_price,
                                "subtotal": detail_data.subtotal,
                            }
                        )

                    imported_count += 1
                except Exception as exc:
                    errors.append(SyncImportErrorItem(movement_index=index, message=str(exc)))

            if movement_rows:
                db.execute(insert(Movement), movement_rows)
            if all_detail_rows:
                db.execute(insert(MovementDetail), all_detail_rows)

            db.commit()
            db.refresh(period)
        except Exception as exc:
            db.rollback()
            raise SyncImportError(f"Failed to import sheet data: {exc}") from exc

        return SyncImportResponse(
            period_id=period.id,
            deleted_previous_sheet_movements=deleted_count,
            imported_movements=imported_count,
            failed_movements=len(errors),
            errors=errors,
        )

    @staticmethod
    def _build_price_rows(prices: list, client_name_to_id: dict[str, UUID]) -> list[dict]:
        dedup_map: dict[tuple, dict] = {}
        for price_data in prices:
            normalized_client = SyncService._normalize_name(price_data.client)
            client_id = client_name_to_id.get(normalized_client)
            if client_id is None:
                continue
            normalized_product = SyncService._normalize_name(price_data.product)
            key = (client_id, normalized_product, price_data.start_date)
            dedup_map[key] = {
                "id": uuid4(),
                "client_id": client_id,
                "product": normalized_product,
                "price": price_data.price,
                "start_date": price_data.start_date,
            }
        return list(dedup_map.values())

    @staticmethod
    def _get_or_create_period(db: Session, period_data, sheet_id: str) -> tuple[Period, bool]:
        period = (
            db.query(Period)
            .filter(
                Period.year == period_data.year,
                Period.month == period_data.month,
            )
            .first()
        )
        if period is not None:
            period.name = period_data.name
            period.start_date = period_data.start_date
            period.end_date = period_data.end_date
            period.sheet_id = sheet_id
            return period, False

        period = Period(
            year=period_data.year,
            month=period_data.month,
            name=period_data.name,
            start_date=period_data.start_date,
            end_date=period_data.end_date,
            sheet_id=sheet_id,
        )
        db.add(period)
        db.flush()
        return period, True

    @staticmethod
    def _normalize_name(name: str) -> str:
        return " ".join(name.strip().split()).lower()

    @staticmethod
    def _clean_names_map(raw_names: Iterable[str]) -> dict[str, str]:
        normalized_to_clean: dict[str, str] = {}
        for raw_name in raw_names:
            clean_name = " ".join(raw_name.strip().split())
            if clean_name:
                normalized_to_clean[SyncService._normalize_name(clean_name)] = clean_name
        return normalized_to_clean

    @staticmethod
    def _get_or_create_entities_map(
        db: Session,
        model: type[Client] | type[Employee] | type[Product],
        normalized_to_clean: dict[str, str],
    ) -> tuple[dict[str, UUID], int]:
        if not normalized_to_clean:
            return {}, 0

        normalized_names = list(normalized_to_clean.keys())
        existing_entities = db.query(model).filter(func.lower(model.name).in_(normalized_names)).all()

        normalized_to_id: dict[str, UUID] = {
            SyncService._normalize_name(entity.name): entity.id for entity in existing_entities
        }

        missing_names = [
            clean_name
            for normalized_name, clean_name in normalized_to_clean.items()
            if normalized_name not in normalized_to_id
        ]
        if missing_names:
            db.execute(insert(model), [{"name": name} for name in missing_names])
            db.flush()
            inserted_entities = db.query(model).filter(func.lower(model.name).in_(normalized_names)).all()
            for entity in inserted_entities:
                normalized_to_id[SyncService._normalize_name(entity.name)] = entity.id

        return normalized_to_id, len(missing_names)
