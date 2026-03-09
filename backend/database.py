from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from backend.config import get_settings


settings = get_settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from backend.models import discussion, requirement, scenario, user  # noqa: F401
    from backend.security import ensure_default_admin

    Base.metadata.create_all(bind=engine)
    _apply_sqlite_compat_migrations()
    ensure_default_admin()


def _apply_sqlite_compat_migrations() -> None:
    if not settings.database_url.startswith("sqlite"):
        return

    with engine.begin() as connection:
        existing_columns = {
            row[1] for row in connection.execute(text("PRAGMA table_info(messages)")).fetchall()
        }
        if "sender_id" not in existing_columns:
            connection.execute(text("ALTER TABLE messages ADD COLUMN sender_id INTEGER"))
        if "sender_name_snapshot" not in existing_columns:
            connection.execute(text("ALTER TABLE messages ADD COLUMN sender_name_snapshot VARCHAR(100)"))
