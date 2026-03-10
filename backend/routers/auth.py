from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import User
from backend.schemas import AuthLogin, AuthTokenRead, UserRead
from backend.security import (
    bearer_scheme,
    create_session_token,
    get_current_user,
    normalize_username,
    revoke_session_token,
    verify_password,
)


router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=AuthTokenRead)
def login(payload: AuthLogin, db: Session = Depends(get_db)) -> AuthTokenRead:
    stmt = select(User).where(User.username == normalize_username(payload.username))
    user = db.scalar(stmt)
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_session_token(db, user)
    return AuthTokenRead(access_token=access_token, user=UserRead.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    _current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    if credentials is not None:
        revoke_session_token(db, credentials.credentials)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UserRead)
def get_me(current_user: User = Depends(get_current_user)) -> UserRead:
    return UserRead.model_validate(current_user)
