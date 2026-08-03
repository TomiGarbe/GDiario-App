# GDiario

Aplicación web para registrar movimientos, gastos, balances y clientes. PostgreSQL es la única fuente de verdad.

## Arquitectura

```
App -> API -> PostgreSQL
```

Google Sheets es una integración manual mediante el Add-on:

- **Sincronizar hacia la App:** el Add-on envía una instantánea del período a `POST /api/sync/full`.
- **Actualizar Google Sheets:** el Add-on obtiene la instantánea autoritativa desde `GET /api/sync/export` y reconstruye la planilla abierta.

No existe sincronización automática, worker, outbox ni acceso del backend a Google Sheets.

## Estructura

- `frontend/`: interfaz web mobile-first.
- `backend/`: API FastAPI, PostgreSQL y migraciones Alembic.
- `add-on/`: Add-on de Google Sheets para las dos acciones manuales.

Consulta [SYNC_SIMPLIFICATION.md](SYNC_SIMPLIFICATION.md) para los detalles de la arquitectura y la migración.
