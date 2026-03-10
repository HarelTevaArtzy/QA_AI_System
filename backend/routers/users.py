from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import User
from backend.schemas import UserCreate, UserRead, UserUpdate
from backend.security import hash_password, require_roles


router = APIRouter(prefix="/users", tags=["Users"])


@router.get("", response_model=list[UserRead])
def list_users(
    _current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> list[User]:
    stmt = select(User).order_by(User.username.asc(), User.id.asc())
    return list(db.scalars(stmt).all())


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    _current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> User:
    existing = db.scalar(select(User).where(User.username == payload.username))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that username already exists.",
        )

    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserRead)
def update_user(
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    existing = db.scalar(select(User).where(User.username == payload.username, User.id != user_id))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with that username already exists.",
        )

    if user.role == "admin" and payload.role != "admin":
        admin_count = db.scalar(select(func.count(User.id)).where(User.role == "admin")) or 0
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one admin user must remain.",
            )

    user.username = payload.username
    user.role = payload.role
    if payload.password:
        user.password_hash = hash_password(payload.password)

    db.add(user)
    db.commit()
    db.refresh(user)

    if current_user.id == user.id and current_user.role != user.role:
        current_user.role = user.role

    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
) -> Response:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete the active admin account.",
        )
    if user.role == "admin":
        admin_count = db.scalar(select(func.count(User.id)).where(User.role == "admin")) or 0
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one admin user must remain.",
            )

    db.delete(user)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
