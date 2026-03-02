from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import Scenario
from backend.services.export_service import build_scenarios_excel, build_scenarios_word


router = APIRouter(prefix="/export", tags=["Export"])


@router.get("/scenarios/excel")
def export_scenarios_excel(db: Session = Depends(get_db)) -> StreamingResponse:
    stmt = select(Scenario).order_by(Scenario.created_at.desc(), Scenario.id.desc())
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
    stmt = select(Scenario).order_by(Scenario.created_at.desc(), Scenario.id.desc())
    scenarios = list(db.scalars(stmt).all())
    file_name = f"qa-scenarios-{datetime.now().strftime('%Y%m%d-%H%M%S')}.docx"
    buffer = build_scenarios_word(scenarios)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )
