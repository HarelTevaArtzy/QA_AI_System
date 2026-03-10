from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Table, Text, Column, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


scenario_requirements = Table(
    "scenario_requirements",
    Base.metadata,
    Column("scenario_id", ForeignKey("scenarios.id", ondelete="CASCADE"), primary_key=True),
    Column("requirement_id", ForeignKey("requirements.id", ondelete="CASCADE"), primary_key=True),
)


class Requirement(Base):
    __tablename__ = "requirements"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("requirements.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    parent: Mapped["Requirement | None"] = relationship(
        remote_side="Requirement.id",
        back_populates="children",
    )
    children: Mapped[list["Requirement"]] = relationship(
        back_populates="parent",
        order_by="Requirement.created_at.asc(), Requirement.id.asc()",
    )
    scenarios: Mapped[list["Scenario"]] = relationship(
        secondary="scenario_requirements",
        back_populates="requirements",
        order_by="Scenario.created_at.desc(), Scenario.id.desc()",
    )
