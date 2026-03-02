from __future__ import annotations

from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.services.agno_agents.model_factory import build_model
from backend.services.agno_agents.tools import build_qa_tools


class ScenarioGeneratorAgent:
    def __init__(self, db: Session, topic_id: int) -> None:
        self.db = db
        self.topic_id = topic_id
        self.settings = get_settings()

    def generate(self, discussion_prompt: str) -> str:
        from agno.agent import Agent

        agent = Agent(
            model=build_model(self.settings),
            description="You convert QA discussions into structured scenario suggestions.",
            instructions=[
                "Generate candidate test scenarios from the discussion context.",
                "Include title, priority, steps, and expected result for each scenario.",
                "Keep the output concise and actionable.",
            ],
            tools=build_qa_tools(self.db, self.topic_id),
            markdown=True,
        )
        result = agent.run(discussion_prompt)
        status = getattr(result, "status", None)
        status_value = getattr(status, "value", str(status or "")).lower()
        content = getattr(result, "content", str(result)).strip()
        if status_value == "error":
            raise RuntimeError(content or "Agent run failed.")
        return content
