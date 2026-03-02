from __future__ import annotations

from collections import Counter

from sqlalchemy import select

from backend.config import get_settings
from backend.database import SessionLocal
from backend.models import Message, Topic
from backend.services.agno_agents.qa_agent import QAAnalystAgent


class EnrichmentService:
    def __init__(self) -> None:
        self.settings = get_settings()

    def enrich_message_by_id(self, message_id: int) -> None:
        with SessionLocal() as db:
            message = db.get(Message, message_id)
            if message is None or message.enriched_content:
                return

            topic = db.get(Topic, message.topic_id)
            if topic is None:
                return

            message.enriched_content = self._generate_enrichment(
                db_message=message,
                topic=topic,
            )
            db.add(message)
            db.commit()

    def _generate_enrichment(self, db_message: Message, topic: Topic) -> str:
        try:
            return QAAnalystAgent(
                db=self._session_from_message(db_message),
                topic_id=topic.id,
            ).enrich(db_message.content)
        except Exception as exc:
            return self._fallback_enrichment(db_message, topic, reason=str(exc))

    @staticmethod
    def _session_from_message(db_message: Message):
        return db_message._sa_instance_state.session

    def _fallback_enrichment(
        self, db_message: Message, topic: Topic, reason: str | None = None
    ) -> str:
        history = self._topic_history(topic.id, current_message_id=db_message.id)
        test_types = self._classify_test_types(db_message.content)
        scenario_ideas = self._scenario_ideas(db_message.content)
        risks = self._risk_prompts(db_message.content)
        note = (
            f"_Fallback enrichment used because Agno/{self.settings.agno_provider} was unavailable: {reason}_\n\n"
            if reason
            else f"_Fallback enrichment used because Agno/{self.settings.agno_provider} is disabled._\n\n"
        )

        parts = [
            note,
            "## Summary",
            f"This discussion appears to focus on **{topic.title}**.",
            db_message.content,
            "",
            "## Suggested Test Types",
            ", ".join(test_types),
            "",
            "## Risks To Probe",
            "\n".join(f"- {risk}" for risk in risks),
            "",
            "## Candidate Scenario Ideas",
            "\n".join(f"- {idea}" for idea in scenario_ideas),
            "",
            "## Best Practices",
            "- Verify preconditions, permissions, and environment setup.",
            "- Cover positive, negative, and boundary behaviors.",
            "- Confirm logging, user feedback, and recovery paths.",
        ]

        if history:
            parts.extend(["", "## Related Discussion Context", history])

        return "\n".join(parts).strip()

    def _topic_history(self, topic_id: int, current_message_id: int) -> str:
        with SessionLocal() as db:
            stmt = (
                select(Message)
                .where(Message.topic_id == topic_id, Message.id != current_message_id)
                .order_by(Message.created_at.desc(), Message.id.desc())
                .limit(5)
            )
            messages = list(reversed(db.scalars(stmt).all()))
        return "\n".join(f"- {message.content}" for message in messages)

    @staticmethod
    def _classify_test_types(content: str) -> list[str]:
        lowered = content.lower()
        labels: list[str] = ["functional"]
        keyword_map = {
            "regression": {"regression", "fix", "again", "existing"},
            "security": {"auth", "permission", "token", "security", "unauthorized"},
            "performance": {"slow", "load", "latency", "timeout", "performance"},
            "usability": {"ui", "ux", "error message", "confusing"},
        }
        for label, keywords in keyword_map.items():
            if any(keyword in lowered for keyword in keywords):
                labels.append(label)
        return labels

    @staticmethod
    def _scenario_ideas(content: str) -> list[str]:
        lowered = content.lower()
        generic = [
            "Validate the primary success path with realistic user data.",
            "Verify failure behavior with invalid or incomplete input.",
            "Test edge conditions around empty values, long values, and repeated actions.",
        ]
        targeted: list[str] = []
        if any(token in lowered for token in {"login", "signin", "auth"}):
            targeted.extend(
                [
                    "Confirm valid credentials produce access and the correct landing page.",
                    "Confirm invalid credentials show a safe error without leaking account state.",
                    "Verify lockout, password reset, and session timeout behavior.",
                ]
            )
        if any(token in lowered for token in {"export", "download", "file"}):
            targeted.extend(
                [
                    "Verify exported files contain all expected records and formatting.",
                    "Check behavior when there is no data to export.",
                ]
            )
        if any(token in lowered for token in {"api", "request", "response"}):
            targeted.extend(
                [
                    "Validate status codes, payload schema, and error handling for malformed requests.",
                    "Verify idempotency and data persistence after repeated API calls.",
                ]
            )
        return targeted or generic

    @staticmethod
    def _risk_prompts(content: str) -> list[str]:
        tokens = EnrichmentService._keywords(content)
        if not tokens:
            return [
                "Clarify the preconditions and user role required for this workflow.",
                "Define expected errors and recovery behavior.",
                "Add at least one negative and one edge-case scenario.",
            ]
        return [
            f"How should the system behave when {tokens[0]} is invalid or missing?",
            "What should be logged or surfaced to the user on failure?",
            "Which boundary, permission, or concurrency cases are still untested?",
        ]

    @staticmethod
    def _keywords(content: str) -> list[str]:
        stop_words = {
            "the",
            "and",
            "for",
            "with",
            "this",
            "that",
            "from",
            "have",
            "user",
            "when",
            "what",
            "into",
            "about",
            "should",
        }
        words = [
            word.strip(".,!?():;[]{}\"'").lower()
            for word in content.split()
            if len(word.strip(".,!?():;[]{}\"'")) > 3
        ]
        ranked = Counter(word for word in words if word not in stop_words)
        return [word for word, _ in ranked.most_common(3)]


def enqueue_enrichment(message_id: int) -> None:
    EnrichmentService().enrich_message_by_id(message_id)
