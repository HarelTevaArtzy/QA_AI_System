from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import case, select
from sqlalchemy.orm import Session, selectinload

from backend.database import get_db
from backend.models import Requirement, Scenario, User
from backend.schemas import ScenarioCreate, ScenarioRead, ScenarioUpdate
from backend.security import get_current_user, require_roles


router = APIRouter(prefix="/scenarios", tags=["Scenarios"])


def _resolve_requirements(db: Session, requirement_ids: list[int]) -> list[Requirement]:
    unique_ids = list(dict.fromkeys(requirement_ids))
    if not unique_ids:
        return []

    stmt = select(Requirement).where(Requirement.id.in_(unique_ids))
    requirements = list(db.scalars(stmt).all())
    if len(requirements) != len(unique_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more linked requirements were not found.",
        )

    requirement_map = {requirement.id: requirement for requirement in requirements}
    return [requirement_map[requirement_id] for requirement_id in unique_ids]


@router.post("", response_model=ScenarioRead, status_code=status.HTTP_201_CREATED)
def create_scenario(
    payload: ScenarioCreate,
    _current_user: User = Depends(require_roles("admin", "qa")),
    db: Session = Depends(get_db),
) -> Scenario:
    data = payload.model_dump(exclude={"requirement_ids"})
    scenario = Scenario(**data)
    scenario.requirements = _resolve_requirements(db, payload.requirement_ids)
    db.add(scenario)
    db.commit()
    return db.scalar(
        select(Scenario)
        .where(Scenario.id == scenario.id)
        .options(selectinload(Scenario.requirements))
    )


@router.get("", response_model=list[ScenarioRead])
def list_scenarios(
    _current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Scenario]:
    priority_rank = case(
        (Scenario.priority == "critical", 0),
        (Scenario.priority == "high", 1),
        (Scenario.priority == "medium", 2),
        (Scenario.priority == "low", 3),
        else_=4,
    )
    stmt = (
        select(Scenario)
        .options(selectinload(Scenario.requirements))
        .order_by(priority_rank.asc(), Scenario.created_at.desc(), Scenario.id.desc())
    )
    return list(db.scalars(stmt).all())


@router.get("/{scenario_id}", response_model=ScenarioRead)
def get_scenario(
    scenario_id: int,
    _current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Scenario:
    scenario = db.scalar(
        select(Scenario)
        .where(Scenario.id == scenario_id)
        .options(selectinload(Scenario.requirements))
    )
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario not found.")
    return scenario


@router.put("/{scenario_id}", response_model=ScenarioRead)
def update_scenario(
    scenario_id: int,
    payload: ScenarioUpdate,
    _current_user: User = Depends(require_roles("admin", "qa")),
    db: Session = Depends(get_db),
) -> Scenario:
    scenario = db.scalar(
        select(Scenario)
        .where(Scenario.id == scenario_id)
        .options(selectinload(Scenario.requirements))
    )
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario not found.")

    for field, value in payload.model_dump(exclude={"requirement_ids"}).items():
        setattr(scenario, field, value)
    scenario.requirements = _resolve_requirements(db, payload.requirement_ids)

    db.add(scenario)
    db.commit()
    return db.scalar(
        select(Scenario)
        .where(Scenario.id == scenario_id)
        .options(selectinload(Scenario.requirements))
    )


@router.delete("/{scenario_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scenario(
    scenario_id: int,
    _current_user: User = Depends(require_roles("admin", "qa")),
    db: Session = Depends(get_db),
) -> Response:
    scenario = db.get(Scenario, scenario_id)
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario not found.")

    db.delete(scenario)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
