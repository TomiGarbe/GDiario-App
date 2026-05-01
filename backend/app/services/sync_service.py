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
    def import_sheet(db: Session, data: SyncImportRequest) -> SyncImportResponse:
        errors: list[SyncImportErrorItem] = []
        imported_count = 0
        deleted_count = 0

        try:
            period = SyncService._get_or_create_period(db, data)
            if data.is_first_batch:
                deleted_count = (
                    db.query(Movement)
                    .filter(Movement.period_id == period.id, Movement.source == "sheet")
                    .delete(synchronize_session=False)
                )

            all_client_names = {
                m.client
                for m in data.movements
                if m.client
            }
            all_client_names.update(p.client for p in data.prices if p.client)

            client_name_to_id = SyncService._get_or_create_entities_map(
                db=db,
                model=Client,
                raw_names=all_client_names,
            )
            employee_name_to_id = SyncService._get_or_create_entities_map(
                db=db,
                model=Employee,
                raw_names=(
                    name
                    for movement in data.movements
                    for name in [movement.employee, *(d.employee for d in movement.details if d.employee)]
                    if name
                ),
            )
            product_name_to_id = SyncService._get_or_create_entities_map(
                db=db,
                model=Product,
                raw_names=(
                    d.product
                    for movement in data.movements
                    for d in movement.details
                    if d.product
                ),
            )
            SyncService._upsert_prices(
                db=db,
                prices=data.prices,
                client_name_to_id=client_name_to_id,
            )

            movement_rows: list[dict] = []
            movement_details_by_index: dict[int, list[dict]] = {}

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

                    detail_rows: list[dict] = []
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

                        detail_rows.append(
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

                    movement_details_by_index[index] = detail_rows
                    imported_count += 1
                except Exception as exc:
                    errors.append(SyncImportErrorItem(movement_index=index, message=str(exc)))

            if movement_rows:
                db.execute(insert(Movement), movement_rows)

            all_detail_rows: list[dict] = []
            for index in range(1, len(data.movements) + 1):
                detail_rows = movement_details_by_index.get(index)
                if detail_rows:
                    all_detail_rows.extend(detail_rows)

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
    def _upsert_prices(
        db: Session,
        prices: Iterable,
        client_name_to_id: dict[str, UUID],
    ) -> None:
        price_rows: list[dict] = []
        for price_data in prices:
            normalized_client = SyncService._normalize_name(price_data.client)
            client_id = client_name_to_id.get(normalized_client)
            if client_id is None:
                continue
            normalized_product = SyncService._normalize_name(price_data.product)
            price_rows.append(
                {
                    "id": uuid4(),
                    "client_id": client_id,
                    "product": normalized_product,
                    "price": price_data.price,
                    "start_date": price_data.start_date,
                }
            )

        if not price_rows:
            return

        stmt = pg_insert(Price).values(price_rows)
        upsert_stmt = stmt.on_conflict_do_update(
            constraint="uq_prices_client_product_start_date",
            set_={"price": stmt.excluded.price},
        )
        db.execute(upsert_stmt)

    @staticmethod
    def _get_or_create_period(db: Session, data: SyncImportRequest) -> Period:
        period = (
            db.query(Period)
            .filter(
                Period.year == data.period.year,
                Period.month == data.period.month,
            )
            .first()
        )
        if period is not None:
            period.name = data.period.name
            period.start_date = data.period.start_date
            period.end_date = data.period.end_date
            period.sheet_id = data.sheet_id
            return period

        period = Period(
            year=data.period.year,
            month=data.period.month,
            name=data.period.name,
            start_date=data.period.start_date,
            end_date=data.period.end_date,
            sheet_id=data.sheet_id,
        )
        db.add(period)
        db.flush()
        return period

    @staticmethod
    def _normalize_name(name: str) -> str:
        return " ".join(name.strip().split()).lower()

    @staticmethod
    def _get_or_create_entities_map(
        db: Session,
        model: type[Client] | type[Employee] | type[Product],
        raw_names: Iterable[str],
    ) -> dict[str, UUID]:
        normalized_to_clean: dict[str, str] = {}
        for raw_name in raw_names:
            clean_name = " ".join(raw_name.strip().split())
            if not clean_name:
                continue
            normalized_to_clean[SyncService._normalize_name(clean_name)] = clean_name

        if not normalized_to_clean:
            return {}

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

        return normalized_to_id
