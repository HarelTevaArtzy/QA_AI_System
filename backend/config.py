from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    app_name: str
    project_root: Path
    frontend_dir: Path
    database_url: str
    default_admin_username: str
    default_admin_password: str
    agno_provider: str
    agno_model: str
    agno_base_url: str | None
    sync_enrichment: bool


@lru_cache
def get_settings() -> Settings:
    project_root = Path(__file__).resolve().parent.parent
    database_file = Path(
        os.getenv("DATABASE_FILE", str(project_root / "qa_system.db"))
    ).expanduser()

    return Settings(
        app_name=os.getenv("APP_NAME", "Agentic QA System"),
        project_root=project_root,
        frontend_dir=project_root / "frontend",
        database_url=os.getenv(
            "DATABASE_URL", f"sqlite:///{database_file.resolve().as_posix()}"
        ),
        default_admin_username=os.getenv("DEFAULT_ADMIN_USERNAME", "admin"),
        default_admin_password=os.getenv("DEFAULT_ADMIN_PASSWORD", "ADMIN123"),
        agno_provider=os.getenv("AGNO_PROVIDER", "ollama").strip().lower(),
        agno_model=os.getenv("AGNO_MODEL", "llama3.1:8b"),
        agno_base_url=os.getenv("AGNO_BASE_URL"),
        sync_enrichment=os.getenv("SYNC_ENRICHMENT", "false").lower()
        in {"1", "true", "yes"},
    )
