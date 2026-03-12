from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import get_settings
from backend.database import init_db
from backend.routers import auth, discussions, export, requirements, scenarios, users


settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
allow_any_origin = "*" in settings.cors_allowed_origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=not allow_any_origin,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(scenarios.router)
app.include_router(discussions.router)
app.include_router(export.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(requirements.router)


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}


frontend_dir = settings.frontend_dir
if frontend_dir.exists():
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
