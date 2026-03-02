from __future__ import annotations

from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.services.agno_agents.model_factory import build_model
from backend.services.agno_agents.tools import build_qa_tools


class QAAnalystAgent:
    def __init__(self, db: Session, topic_id: int) -> None:
        self.db = db
        self.topic_id = topic_id
        self.settings = get_settings()

    def enrich(self, message_content: str) -> str:
        from agno.agent import Agent

        agent = Agent(
            model=build_model(self.settings),
            description=(
                "You are a QA Analyst Agent that enriches testing discussions into "
                "structured, reusable QA knowledge."
            ),
            instructions=[
                "Analyze the newest message in the context of the topic history.",
                "Use tools when they help ground the answer in stored project knowledge.",
                "Respond with short markdown sections: Summary, Risks, Test Ideas, Best Practices.",
                "Suggest concrete QA scenarios and edge cases whenever possible.",
                "Do not invent product behavior that is not implied by the discussion.",
            ],
            tools=build_qa_tools(self.db, self.topic_id),
            markdown=True,
        )
        prompt = (
            "Enrich the following QA discussion message so it becomes useful stored knowledge.\n\n"
            f"Latest message:\n{message_content}"
        )
        result = agent.run(prompt)
        status = getattr(result, "status", None)
        status_value = getattr(status, "value", str(status or "")).lower()
        content = getattr(result, "content", str(result)).strip()
        if status_value == "error":
            raise RuntimeError(content or "Agent run failed.")
        return content
