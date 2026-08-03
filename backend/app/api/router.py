from fastapi import APIRouter

from app.api.routes import auth, clients, health, movements, sync

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router)
api_router.include_router(clients.router)
api_router.include_router(movements.router)
api_router.include_router(sync.router)
