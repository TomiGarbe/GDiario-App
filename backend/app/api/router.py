from fastapi import APIRouter

from app.api.routes import auth, clients, health, movements, sheet_sync, sync

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router)
api_router.include_router(clients.router)
api_router.include_router(movements.router)
api_router.include_router(sheet_sync.router)
api_router.include_router(sync.router)
