from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models import Message, Scenario


def build_qa_tools(db: Session, topic_id: int) -> list:
    def get_topic_history(limit: int = 8) -> str:
        """Return the most recent messages from the current QA topic."""
        stmt = (
            select(Message)
            .where(Message.topic_id == topic_id)
            .order_by(Message.created_at.desc(), Message.id.desc())
            .limit(limit)
        )
        messages = list(reversed(db.scalars(stmt).all()))
        if not messages:
            return "No prior discussion messages found."

        return "\n".join(
            f"- Message {message.id}: {message.content}" for message in messages
        )

    def find_related_scenarios(keyword: str = "") -> str:
        """Search stored QA scenarios related to a keyword or return recent ones if keyword is blank."""
        stmt = select(Scenario).order_by(Scenario.created_at.desc(), Scenario.id.desc())
        if keyword.strip():
            pattern = f"%{keyword.strip()}%"
            stmt = stmt.where(
                Scenario.title.ilike(pattern) | Scenario.description.ilike(pattern)
            )
        scenarios = db.scalars(stmt.limit(5)).all()
        if not scenarios:
            return "No related scenarios found."

        return "\n".join(
            f"- [{scenario.priority}] {scenario.title}: {scenario.description}"
            for scenario in scenarios
        )

    def qa_best_practices() -> str:
        """Return concise QA heuristics the agent can use when enriching a discussion."""
        return (
            "Cover happy path, negative path, boundary conditions, permission checks, "
            "error messaging, observability, data validation, and recovery behavior."
        )

    return [get_topic_history, find_related_scenarios, qa_best_practices]
