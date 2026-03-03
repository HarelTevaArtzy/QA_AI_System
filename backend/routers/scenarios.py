from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import case, select
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Scenario
from backend.schemas import ScenarioCreate, ScenarioRead, ScenarioUpdate


router = APIRouter(prefix="/scenarios", tags=["Scenarios"])


@router.post("", response_model=ScenarioRead, status_code=status.HTTP_201_CREATED)
def create_scenario(payload: ScenarioCreate, db: Session = Depends(get_db)) -> Scenario:
    scenario = Scenario(**payload.model_dump())
    db.add(scenario)
    db.commit()
    db.refresh(scenario)
    return scenario


@router.get("", response_model=list[ScenarioRead])
def list_scenarios(db: Session = Depends(get_db)) -> list[Scenario]:
    priority_rank = case(
        (Scenario.priority == "critical", 0),
        (Scenario.priority == "high", 1),
        (Scenario.priority == "medium", 2),
        (Scenario.priority == "low", 3),
        else_=4,
    )
    stmt = select(Scenario).order_by(priority_rank.asc(), Scenario.created_at.desc(), Scenario.id.desc())
    return list(db.scalars(stmt).all())


@router.get("/{scenario_id}", response_model=ScenarioRead)
def get_scenario(scenario_id: int, db: Session = Depends(get_db)) -> Scenario:
    scenario = db.get(Scenario, scenario_id)
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario not found.")
    return scenario


@router.put("/{scenario_id}", response_model=ScenarioRead)
def update_scenario(
    scenario_id: int, payload: ScenarioUpdate, db: Session = Depends(get_db)
) -> Scenario:
    scenario = db.get(Scenario, scenario_id)
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario not found.")

    for field, value in payload.model_dump().items():
        setattr(scenario, field, value)

    db.add(scenario)
    db.commit()
    db.refresh(scenario)
    return scenario


@router.delete("/{scenario_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scenario(scenario_id: int, db: Session = Depends(get_db)) -> Response:
    scenario = db.get(Scenario, scenario_id)
    if scenario is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scenario not found.")

    db.delete(scenario)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
