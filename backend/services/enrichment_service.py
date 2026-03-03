from __future__ import annotations

from collections import Counter
import re

from sqlalchemy import select

from backend.config import get_settings
from backend.database import SessionLocal
from backend.models import Message, Scenario, Topic
from backend.services.agno_agents.qa_agent import (
    QAAnalystAgent,
    normalize_enrichment_markdown,
)


class EnrichmentService:
    SECTION_TITLE_ALIASES = {
        "summary": "Summary",
        "risks": "Risks",
        "risks to probe": "Risks",
        "test ideas": "Test Ideas",
        "candidate scenario ideas": "Test Ideas",
        "best practices": "Best Practices",
        "related scenarios": "Related Scenarios",
        "qa heuristics": "QA Heuristics",
        "related discussion context": "Related Discussion Context",
    }
    SECTION_ORDER = [
        "Summary",
        "Risks",
        "Test Ideas",
        "Best Practices",
        "Related Scenarios",
        "QA Heuristics",
        "Related Discussion Context",
    ]

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
            return self._ensure_required_sections(
                QAAnalystAgent(
                    db=self._session_from_message(db_message),
                    topic_id=topic.id,
                ).enrich(db_message.content),
                db_message,
            )
        except Exception as exc:
            return self._ensure_required_sections(
                self._fallback_enrichment(db_message, topic, reason=str(exc)),
                db_message,
            )

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
        related_scenarios = self._related_scenarios(db_message.content)
        qa_heuristics = self._qa_heuristics()
        parts = [
            "## Summary",
            f"This discussion appears to focus on **{topic.title}**.",
            db_message.content,
            "",
            "## Risks To Probe",
            "\n".join(f"- {risk}" for risk in risks),
            "",
            "## Candidate Scenario Ideas",
            self._format_test_ideas(scenario_ideas, db_message.content, test_types),
            "",
            "## Best Practices",
            "- Verify preconditions, permissions, and environment setup.",
            "- Cover positive, negative, and boundary behaviors.",
            "- Confirm logging, user feedback, and recovery paths.",
            "",
            "## Related Scenarios",
            related_scenarios,
            "",
            "## QA Heuristics",
            qa_heuristics,
        ]

        if history:
            parts.extend(["", "## Related Discussion Context", history])

        return "\n".join(parts).strip()

    def _ensure_required_sections(self, content: str, db_message: Message) -> str:
        normalized = self._normalize_sections(normalize_enrichment_markdown(content))
        normalized = self._upsert_section(
            normalized,
            "Test Ideas",
            self._format_test_ideas(
                self._existing_or_fallback_test_ideas(normalized, db_message.content),
                db_message.content,
            ),
        )
        normalized = self._upsert_section(
            normalized,
            "Related Scenarios",
            self._related_scenarios(db_message.content),
        )
        return self._normalize_sections(
            self._upsert_section(
                self._normalize_sections(normalized),
                "QA Heuristics",
                self._qa_heuristics(),
            )
        )

    @staticmethod
    def _upsert_section(content: str, title: str, body: str) -> str:
        section_block = f"## {title}\n\n{body}".strip()
        pattern = re.compile(
            rf"(?ims)^##\s*{re.escape(title)}\b.*?(?=^##\s|\Z)"
        )
        if pattern.search(content):
            return pattern.sub(section_block, content, count=1).strip()
        return f"{content.rstrip()}\n\n{section_block}".strip()

    @classmethod
    def _normalize_sections(cls, content: str) -> str:
        normalized = re.sub(r"([^\n])\s*(##\s*[A-Za-z])", r"\1\n\n\2", content).strip()
        pattern = re.compile(r"(?ims)^##\s*(.+?)\s*$([\s\S]*?)(?=^##\s|\Z)")
        section_map: dict[str, str] = {}

        for match in pattern.finditer(normalized):
            raw_title = match.group(1).strip()
            title = cls.SECTION_TITLE_ALIASES.get(raw_title.lower())
            if not title:
                continue
            body = match.group(2).strip()
            if body:
                section_map[title] = body

        if not section_map:
            return normalized

        ordered_sections = [
            f"## {title}\n\n{section_map[title]}".strip()
            for title in cls.SECTION_ORDER
            if title in section_map
        ]
        return "\n\n".join(ordered_sections).strip()

    @staticmethod
    def _section_body(content: str, title: str) -> str | None:
        pattern = re.compile(
            rf"(?ims)^##\s*{re.escape(title)}\b\s*(.*?)(?=^##\s|\Z)"
        )
        match = pattern.search(content)
        if not match:
            return None
        body = match.group(1).strip()
        return body or None

    def _existing_or_fallback_test_ideas(
        self, content: str, source_content: str
    ) -> list[str]:
        existing_body = self._section_body(content, "Test Ideas")
        extracted = self._extract_test_ideas(existing_body) if existing_body else []
        return extracted or self._scenario_ideas(source_content)

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

    def _related_scenarios(self, content: str) -> str:
        keywords = self._keywords(content)
        matched: list[Scenario] = []
        seen_ids: set[int] = set()

        with SessionLocal() as db:
            for keyword in keywords:
                pattern = f"%{keyword}%"
                stmt = (
                    select(Scenario)
                    .where(
                        Scenario.title.ilike(pattern)
                        | Scenario.description.ilike(pattern)
                    )
                    .order_by(Scenario.created_at.desc(), Scenario.id.desc())
                    .limit(5)
                )
                for scenario in db.scalars(stmt).all():
                    if scenario.id in seen_ids:
                        continue
                    seen_ids.add(scenario.id)
                    matched.append(scenario)
                    if len(matched) >= 3:
                        break
                if len(matched) >= 3:
                    break

        if not matched:
            return "No related scenarios found."

        return "\n".join(
            f"- [{scenario.priority}] **{scenario.title}**: {scenario.description}"
            for scenario in matched
        )

    @staticmethod
    def _qa_heuristics() -> str:
        return "\n".join(
            [
                "- Cover happy path, negative path, and boundary conditions.",
                "- Check permissions, data validation, and error messaging.",
                "- Confirm observability, recovery behavior, and user feedback.",
            ]
        )

    @staticmethod
    def _classify_test_types(content: str) -> list[str]:
        lowered = content.lower()
        labels: list[str] = ["functional"]
        keyword_map = {
            "regression": {"regression", "fix", "again", "existing"},
            "security": {"auth", "permission", "token", "security", "unauthorized"},
            "performance": {"slow", "load", "latency", "timeout", "performance"},
        }
        for label, keywords in keyword_map.items():
            if any(keyword in lowered for keyword in keywords):
                labels.append(label)
        return labels

    @staticmethod
    def _extract_test_ideas(body: str | None) -> list[str]:
        if not body:
            return []
        items: list[str] = []
        for line in body.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            bullet_match = re.match(r"^(?:[-*]|\d+\.)\s+(.+)$", stripped)
            items.append((bullet_match.group(1) if bullet_match else stripped).strip())
        return [item for item in items if item]

    @staticmethod
    def _normalize_test_idea_text(idea: str) -> str:
        normalized = idea.strip()
        normalized = re.sub(
            r"\s*-\s*\[(?:functional|regression|performance|security)(?:\s*,\s*(?:functional|regression|performance|security))*\]\s*$",
            "",
            normalized,
            flags=re.IGNORECASE,
        )
        normalized = re.sub(
            r"\s*-\s*(?:functional|regression|performance|security)(?:\s*,\s*(?:functional|regression|performance|security))*\s*$",
            "",
            normalized,
            flags=re.IGNORECASE,
        )
        return normalized.strip()

    def _format_test_ideas(
        self,
        ideas: list[str],
        source_content: str,
        baseline_types: list[str] | None = None,
    ) -> str:
        baseline = baseline_types or self._classify_test_types(source_content)
        lines: list[str] = []
        for index, idea in enumerate(ideas, start=1):
            normalized_idea = self._normalize_test_idea_text(idea)
            idea_types = self._classify_test_types(f"{source_content} {normalized_idea}")
            relevant_types = [test_type for test_type in idea_types if test_type in baseline]
            if not relevant_types:
                relevant_types = ["functional"]
            lines.append(f"{index}. {normalized_idea} - {', '.join(relevant_types)}")
        return "\n".join(lines)

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
