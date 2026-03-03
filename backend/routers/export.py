from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import case, select
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Scenario
from backend.services.export_service import build_scenarios_excel, build_scenarios_word


router = APIRouter(prefix="/export", tags=["Export"])


def _scenario_export_stmt():
    priority_rank = case(
        (Scenario.priority == "critical", 0),
        (Scenario.priority == "high", 1),
        (Scenario.priority == "medium", 2),
        (Scenario.priority == "low", 3),
        else_=4,
    )
    return select(Scenario).order_by(
        priority_rank.asc(), Scenario.created_at.desc(), Scenario.id.desc()
    )


@router.get("/scenarios/excel")
def export_scenarios_excel(db: Session = Depends(get_db)) -> StreamingResponse:
    stmt = _scenario_export_stmt()
    scenarios = list(db.scalars(stmt).all())
    file_name = f"qa-scenarios-{datetime.now().strftime('%Y%m%d-%H%M%S')}.xlsx"
    buffer = build_scenarios_excel(scenarios)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


@router.get("/scenarios/word")
def export_scenarios_word(db: Session = Depends(get_db)) -> StreamingResponse:
    stmt = _scenario_export_stmt()
    scenarios = list(db.scalars(stmt).all())
    file_name = f"qa-scenarios-{datetime.now().strftime('%Y%m%d-%H%M%S')}.docx"
    buffer = build_scenarios_word(scenarios)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )
