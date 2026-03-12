from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


DEFAULT_DATABASE_PATH = "qa_system.db"
DEFAULT_AI_BASE_URL = "http://localhost:11434"
DEFAULT_INTERNAL_API_URL = "http://localhost:8001"


def _parse_csv(value: str | None) -> list[str]:
    if value is None:
        return []
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str
    project_root: Path
    frontend_dir: Path
    database_path: Path
    database_url: str
    default_admin_username: str
    default_admin_password: str
    agno_provider: str
    agno_model: str
    ai_base_url: str
    internal_api_url: str
    cors_allowed_origins: list[str]
    sync_enrichment: bool


@lru_cache
def get_settings() -> Settings:
    project_root = Path(__file__).resolve().parent.parent
    database_file = Path(
        os.getenv(
            "DATABASE_PATH",
            os.getenv("DATABASE_FILE", str(project_root / DEFAULT_DATABASE_PATH)),
        )
    ).expanduser()
    if not database_file.is_absolute():
        database_file = project_root / database_file
    database_file = database_file.resolve()
    ai_base_url = (
        os.getenv("AI_BASE_URL", os.getenv("AGNO_BASE_URL", DEFAULT_AI_BASE_URL)).strip()
        or DEFAULT_AI_BASE_URL
    )
    internal_api_url = (
        os.getenv("INTERNAL_API_URL", DEFAULT_INTERNAL_API_URL).strip()
        or DEFAULT_INTERNAL_API_URL
    )
    cors_allowed_origins = _parse_csv(os.getenv("CORS_ALLOWED_ORIGINS"))
    if not cors_allowed_origins:
        cors_allowed_origins = ["*"]

    return Settings(
        app_name=os.getenv("APP_NAME", "Agentic QA System"),
        project_root=project_root,
        frontend_dir=project_root / "frontend",
        database_path=database_file,
        database_url=os.getenv(
            "DATABASE_URL", f"sqlite:///{database_file.as_posix()}"
        ),
        default_admin_username=os.getenv("DEFAULT_ADMIN_USERNAME", "admin"),
        default_admin_password=os.getenv("DEFAULT_ADMIN_PASSWORD", "ADMIN123"),
        agno_provider=os.getenv("AGNO_PROVIDER", "ollama").strip().lower(),
        agno_model=os.getenv("AGNO_MODEL", "llama3.1:8b"),
        ai_base_url=ai_base_url,
        internal_api_url=internal_api_url,
        cors_allowed_origins=cors_allowed_origins,
        sync_enrichment=os.getenv("SYNC_ENRICHMENT", "false").lower()
        in {"1", "true", "yes"},
    )
