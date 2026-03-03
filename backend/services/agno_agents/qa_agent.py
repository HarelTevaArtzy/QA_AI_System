from __future__ import annotations

import re

from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.services.agno_agents.model_factory import build_model
from backend.services.agno_agents.tools import build_qa_tools

SUMMARY_HEADING_PATTERN = re.compile(r"(?im)^##\s*summary\b")


def normalize_enrichment_markdown(content: str) -> str:
    cleaned = content.strip()
    match = SUMMARY_HEADING_PATTERN.search(cleaned)
    if match:
        return cleaned[match.start():].strip()
    return cleaned


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
                "Respond with short markdown sections in this order: Summary, Risks, Test Ideas, Best Practices, Related Scenarios, QA Heuristics.",
                "Your output must begin with exactly '## Summary'.",
                "Always include a '## Test Ideas' section.",
                "For every test idea, append the applicable test type labels using only: functional, regression, performance, security.",
                "Example format: '1. Enter credentials and press login - functional, regression'.",
                "Always include a '## Related Scenarios' section. If there are none, state that clearly.",
                "Always include a '## QA Heuristics' section.",
                "Do not include tool-call descriptions, reasoning, JSON, or setup text before the markdown sections.",
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
        content = normalize_enrichment_markdown(
            getattr(result, "content", str(result))
        )
        if status_value == "error":
            raise RuntimeError(content or "Agent run failed.")
        return content
