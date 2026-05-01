from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.client import Client
from app.models.employee import Employee
from app.models.movement import Movement
from app.models.movement_detail import MovementDetail
from app.models.period import Period
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
        client_cache: dict[str, Client] = {}
        employee_cache: dict[str, Employee] = {}
        product_cache: dict[str, Product] = {}
        errors: list[SyncImportErrorItem] = []
        imported_count = 0

        try:
            period = SyncService._get_or_create_period(db, data)
            deleted_count = (
                db.query(Movement)
                .filter(Movement.period_id == period.id, Movement.source == "sheet")
                .delete(synchronize_session=False)
            )

            for index, movement_data in enumerate(data.movements, start=1):
                try:
                    with db.begin_nested():
                        movement = Movement(
                            period_id=period.id,
                            date=movement_data.date,
                            type=movement_data.type,
                            amount=movement_data.amount,
                            description=movement_data.description,
                            source="sheet",
                            sheet_id=data.sheet_id,
                        )

                        if movement_data.client:
                            movement.client = SyncService._get_or_create_entity(
                                db=db,
                                model=Client,
                                raw_name=movement_data.client,
                                cache=client_cache,
                            )

                        if movement_data.employee:
                            movement.employee = SyncService._get_or_create_entity(
                                db=db,
                                model=Employee,
                                raw_name=movement_data.employee,
                                cache=employee_cache,
                            )

                        db.add(movement)
                        db.flush()

                        for detail_data in movement_data.details:
                            detail = MovementDetail(
                                movement_id=movement.id,
                                type=detail_data.type,
                                quantity=detail_data.quantity,
                                unit_price=detail_data.unit_price,
                                subtotal=detail_data.subtotal,
                            )

                            if detail_data.type == "producto":
                                if not detail_data.product:
                                    raise SyncImportError("detail.product is required when detail.type='producto'")
                                detail.product = SyncService._get_or_create_entity(
                                    db=db,
                                    model=Product,
                                    raw_name=detail_data.product,
                                    cache=product_cache,
                                )

                            if detail_data.type == "empleado":
                                employee_name = detail_data.employee or movement_data.employee
                                if not employee_name:
                                    raise SyncImportError(
                                        "detail.employee or movement.employee is required when detail.type='empleado'"
                                    )
                                detail.employee = SyncService._get_or_create_entity(
                                    db=db,
                                    model=Employee,
                                    raw_name=employee_name,
                                    cache=employee_cache,
                                )

                            db.add(detail)

                    imported_count += 1
                except Exception as exc:
                    errors.append(SyncImportErrorItem(movement_index=index, message=str(exc)))

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
    def _get_or_create_entity(
        db: Session,
        model: type[Client] | type[Employee] | type[Product],
        raw_name: str,
        cache: dict[str, Client | Employee | Product],
    ) -> Client | Employee | Product:
        normalized_name = SyncService._normalize_name(raw_name)
        if normalized_name in cache:
            return cache[normalized_name]

        existing = db.query(model).filter(func.lower(model.name) == normalized_name).first()
        if existing is not None:
            cache[normalized_name] = existing
            return existing

        entity = model(name=" ".join(raw_name.strip().split()))
        db.add(entity)
        db.flush()
        cache[normalized_name] = entity
        return entity
