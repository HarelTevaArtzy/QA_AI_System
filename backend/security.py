from __future__ import annotations

import hashlib
import hmac
import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.database import SessionLocal, get_db
from backend.models import AuthSession, User


ROLE_VALUES = ("admin", "qa", "viewer")
CONTENT_WRITE_ROLES = {"admin", "qa"}
bearer_scheme = HTTPBearer(auto_error=False)


def normalize_username(username: str) -> str:
    normalized = username.strip().lower()
    if not normalized:
        raise ValueError("Username must not be empty.")
    return normalized


def normalize_role(role: str) -> str:
    normalized = role.strip().lower()
    if normalized not in ROLE_VALUES:
        raise ValueError(f"Role must be one of: {', '.join(ROLE_VALUES)}.")
    return normalized


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    iterations = 200_000
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), iterations)
    return f"pbkdf2_sha256${iterations}${salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations_raw, salt, digest = stored_hash.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        int(iterations_raw),
    ).hex()
    return hmac.compare_digest(derived, digest)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session_token(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    session = AuthSession(user_id=user.id, token_hash=hash_token(token))
    db.add(session)
    db.commit()
    return token


def revoke_session_token(db: Session, token: str) -> None:
    stmt = select(AuthSession).where(AuthSession.token_hash == hash_token(token))
    session = db.scalar(stmt)
    if session is None:
        return
    db.delete(session)
    db.commit()


def authentication_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise authentication_error()

    stmt = (
        select(User)
        .join(AuthSession, AuthSession.user_id == User.id)
        .where(AuthSession.token_hash == hash_token(credentials.credentials))
    )
    user = db.scalar(stmt)
    if user is None:
        raise authentication_error()
    return user


def require_roles(*allowed_roles: str):
    normalized_roles = {normalize_role(role) for role in allowed_roles}

    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in normalized_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action.",
            )
        return user

    return dependency


def ensure_default_admin() -> None:
    settings = get_settings()
    with SessionLocal() as db:
        existing_user = db.scalar(select(User.id).limit(1))
        if existing_user is not None:
            return

        admin = User(
            username=normalize_username(settings.default_admin_username),
            password_hash=hash_password(settings.default_admin_password),
            role="admin",
        )
        db.add(admin)
        db.commit()
