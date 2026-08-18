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

## Despliegue

- **Backend + PostgreSQL:** corren en el **server propio** (Docker sobre WSL2),
  expuestos por Cloudflare Tunnel en `gdiario-api.botly.com.ar`. Las migraciones
  Alembic se aplican solas al arrancar (`RUN_STARTUP_MIGRATIONS=true`).
- **Frontend:** Vercel, apuntando a `gdiario-api.botly.com.ar`.
- El add-on de Google Sheets consume esa misma API pública.

Consulta [SYNC_SIMPLIFICATION.md](SYNC_SIMPLIFICATION.md) para los detalles de la arquitectura y la migración.
