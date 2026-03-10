from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.database import get_db
from backend.models import Requirement, Scenario, User
from backend.schemas import (
    RequirementCreate,
    RequirementRead,
    RequirementScenarioCreate,
    RequirementSummaryRead,
    RequirementTreeRead,
    RequirementUpdate,
    ScenarioRead,
    ScenarioSuggestionsCreate,
    ScenarioSuggestionsRead,
    ScenarioSummaryRead,
)
from backend.security import get_current_user, require_roles
from backend.services.agno_agents.scenario_agent import (
    normalize_scenario_suggestions_markdown,
    parse_scenario_suggestions,
)
from backend.services.requirement_service import (
    build_requirement_fallback_suggestions,
    build_requirement_scenario_suggestions,
)


router = APIRouter(prefix="/requirements", tags=["Requirements"])


def _get_requirement_or_404(db: Session, requirement_id: int) -> Requirement:
    stmt = (
        select(Requirement)
        .where(Requirement.id == requirement_id)
        .options(
            selectinload(Requirement.parent),
            selectinload(Requirement.children),
            selectinload(Requirement.scenarios).selectinload(Scenario.requirements),
        )
    )
    requirement = db.scalar(stmt)
    if requirement is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Requirement not found.")
    return requirement


def _serialize_requirement(requirement: Requirement) -> RequirementRead:
    children = [
        RequirementSummaryRead.model_validate(child)
        for child in sorted(requirement.children, key=lambda item: (item.created_at, item.id))
    ]
    scenarios = [
        ScenarioSummaryRead.model_validate(scenario)
        for scenario in sorted(
            requirement.scenarios,
            key=lambda item: (item.created_at, item.id),
            reverse=True,
        )
    ]
    parent = (
        RequirementSummaryRead.model_validate(requirement.parent)
        if requirement.parent is not None
        else None
    )
    return RequirementRead(
        id=requirement.id,
        title=requirement.title,
        description=requirement.description,
        parent_id=requirement.parent_id,
        created_at=requirement.created_at,
        parent=parent,
        children=children,
        scenarios=scenarios,
    )


def _serialize_requirement_tree(requirement: Requirement, children_by_parent: dict[int | None, list[Requirement]]) -> RequirementTreeRead:
    children = children_by_parent.get(requirement.id, [])
    ordered_children = sorted(children, key=lambda item: (item.created_at, item.id))
    return RequirementTreeRead(
        id=requirement.id,
        title=requirement.title,
        description=requirement.description,
        parent_id=requirement.parent_id,
        created_at=requirement.created_at,
        scenario_count=len(requirement.scenarios),
        children=[
            _serialize_requirement_tree(child, children_by_parent) for child in ordered_children
        ],
    )


def _resolve_parent(
    db: Session,
    parent_id: int | None,
    requirement: Requirement | None = None,
) -> Requirement | None:
    if parent_id is None:
        return None

    parent = db.get(Requirement, parent_id)
    if parent is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent requirement not found.")

    if requirement is None:
        return parent

    if parent.id == requirement.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A requirement cannot be its own parent.",
        )

    current = parent
    while current.parent_id is not None:
        if current.parent_id == requirement.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A requirement cannot be assigned under one of its descendants.",
            )
        current = db.get(Requirement, current.parent_id)
        if current is None:
            break

    return parent


def _create_requirement_linked_scenarios(
    db: Session,
    requirement: Requirement,
    content: str,
) -> list[Scenario]:
    parsed_scenarios = parse_scenario_suggestions(content)
    if not parsed_scenarios:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Unable to parse generated scenarios.",
        )

    created: list[Scenario] = []
    for item in parsed_scenarios:
        scenario = Scenario(**item)
        scenario.requirements = [requirement]
        db.add(scenario)
        created.append(scenario)

    db.commit()
    for scenario in created:
        db.refresh(scenario)
    return created


@router.get("", response_model=list[RequirementTreeRead])
def list_requirements(
    _current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[RequirementTreeRead]:
    stmt = (
        select(Requirement)
        .options(selectinload(Requirement.scenarios))
        .order_by(Requirement.created_at.asc(), Requirement.id.asc())
    )
    requirements = list(db.scalars(stmt).all())
    children_by_parent: dict[int | None, list[Requirement]] = {}
    for requirement in requirements:
        children_by_parent.setdefault(requirement.parent_id, []).append(requirement)

    roots = children_by_parent.get(None, [])
    return [_serialize_requirement_tree(requirement, children_by_parent) for requirement in roots]


@router.post("", response_model=RequirementRead, status_code=status.HTTP_201_CREATED)
def create_requirement(
    payload: RequirementCreate,
    _current_user: User = Depends(require_roles("admin", "qa")),
    db: Session = Depends(get_db),
) -> RequirementRead:
    _resolve_parent(db, payload.parent_id)
    requirement = Requirement(**payload.model_dump())
    db.add(requirement)
    db.commit()
    db.refresh(requirement)
    requirement = _get_requirement_or_404(db, requirement.id)
    return _serialize_requirement(requirement)


@router.get("/{requirement_id}", response_model=RequirementRead)
def get_requirement(
    requirement_id: int,
    _current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RequirementRead:
    requirement = _get_requirement_or_404(db, requirement_id)
    return _serialize_requirement(requirement)


@router.put("/{requirement_id}", response_model=RequirementRead)
def update_requirement(
    requirement_id: int,
    payload: RequirementUpdate,
    _current_user: User = Depends(require_roles("admin", "qa")),
    db: Session = Depends(get_db),
) -> RequirementRead:
    requirement = _get_requirement_or_404(db, requirement_id)
    _resolve_parent(db, payload.parent_id, requirement=requirement)

    requirement.title = payload.title
    requirement.description = payload.description
    requirement.parent_id = payload.parent_id

    db.add(requirement)
    db.commit()
    requirement = _get_requirement_or_404(db, requirement_id)
    return _serialize_requirement(requirement)


@router.delete("/{requirement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_requirement(
    requirement_id: int,
    _current_user: User = Depends(require_roles("admin", "qa")),
    db: Session = Depends(get_db),
) -> Response:
    requirement = _get_requirement_or_404(db, requirement_id)
    for child in requirement.children:
        child.parent_id = None
        db.add(child)
    requirement.scenarios.clear()
    db.delete(requirement)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{requirement_id}/scenarios", response_model=ScenarioRead, status_code=status.HTTP_201_CREATED)
def create_scenario_from_requirement(
    requirement_id: int,
    payload: RequirementScenarioCreate,
    _current_user: User = Depends(require_roles("admin", "qa")),
    db: Session = Depends(get_db),
) -> Scenario:
    requirement = _get_requirement_or_404(db, requirement_id)
    scenario = Scenario(**payload.model_dump())
    scenario.requirements = [requirement]
    db.add(scenario)
    db.commit()
    db.refresh(scenario)
    return db.scalar(
        select(Scenario)
        .where(Scenario.id == scenario.id)
        .options(selectinload(Scenario.requirements))
    )


@router.post("/{requirement_id}/scenario-suggestions", response_model=ScenarioSuggestionsRead)
def generate_requirement_scenarios(
    requirement_id: int,
    _current_user: User = Depends(require_roles("admin", "qa")),
    db: Session = Depends(get_db),
) -> ScenarioSuggestionsRead:
    requirement = _get_requirement_or_404(db, requirement_id)
    content = normalize_scenario_suggestions_markdown(
        build_requirement_scenario_suggestions(requirement)
    )
    scenarios = parse_scenario_suggestions(content)
    if not scenarios:
        content = build_requirement_fallback_suggestions(requirement)
        scenarios = parse_scenario_suggestions(content)
    return ScenarioSuggestionsRead(content=content, scenarios=scenarios)


@router.post(
    "/{requirement_id}/scenario-suggestions/save",
    response_model=list[ScenarioRead],
    status_code=status.HTTP_201_CREATED,
)
def save_requirement_scenarios(
    requirement_id: int,
    payload: ScenarioSuggestionsCreate,
    _current_user: User = Depends(require_roles("admin", "qa")),
    db: Session = Depends(get_db),
) -> list[Scenario]:
    requirement = _get_requirement_or_404(db, requirement_id)
    created = _create_requirement_linked_scenarios(db, requirement, payload.content)
    stmt = (
        select(Scenario)
        .where(Scenario.id.in_([scenario.id for scenario in created]))
        .options(selectinload(Scenario.requirements))
        .order_by(Scenario.created_at.desc(), Scenario.id.desc())
    )
    return list(db.scalars(stmt).all())
