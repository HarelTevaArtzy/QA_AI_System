from __future__ import annotations

import re

from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.services.agno_agents.model_factory import build_model
from backend.services.agno_agents.tools import build_qa_tools

SCENARIO_SUGGESTIONS_HEADING_PATTERN = re.compile(
    r"(?im)^##\s*scenario suggestions\b"
)
INVALID_SCENARIO_TITLE_PATTERN = re.compile(
    r"(?im)^(priority|steps|expected result|test steps)\b"
)


def normalize_scenario_suggestions_markdown(content: str) -> str:
    cleaned = content.strip()
    match = SCENARIO_SUGGESTIONS_HEADING_PATTERN.search(cleaned)
    if match:
        cleaned = cleaned[match.start():].strip()
    cleaned = re.sub(r"([^\n])\s*(#{2,3}\s*[A-Za-z])", r"\1\n\n\2", cleaned)
    return cleaned.strip()


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
                "Your output must begin with exactly '## Scenario Suggestions'.",
                "Generate only the number of scenarios that are necessary, with a hard maximum of 3.",
                "For each scenario, use a '### <title>' heading followed by Description, Priority, Steps, and Expected Result fields.",
                "Include title, description, priority, steps, and expected result for each scenario.",
                "Do not include tool-call descriptions, reasoning, JSON, or setup text before the markdown sections.",
                "Keep the output concise and actionable.",
            ],
            tools=build_qa_tools(self.db, self.topic_id),
            markdown=True,
        )
        result = agent.run(discussion_prompt)
        status = getattr(result, "status", None)
        status_value = getattr(status, "value", str(status or "")).lower()
        content = normalize_scenario_suggestions_markdown(
            getattr(result, "content", str(result))
        )
        if status_value == "error":
            raise RuntimeError(content or "Agent run failed.")
        return content


def build_fallback_scenario_suggestions(discussion_prompt: str) -> str:
    lowered = discussion_prompt.lower()
    primary_title = "Regression scenario"
    edge_title = "Edge-case scenario"

    if any(token in lowered for token in {"login", "signin", "auth"}):
        primary_title = "Regression scenario: login redirects to homepage"
        edge_title = "Edge-case scenario: login failure and redirect handling"

    return "\n".join(
        [
            "## Scenario Suggestions",
            "",
            f"### {primary_title}",
            "- Description: Covers the main reported workflow and verifies the expected landing state after login.",
            "- Priority: high",
            "- Steps:",
            "  - Reproduce the reported workflow with realistic user data.",
            "  - Confirm the expected system transition occurs after the main action.",
            "- Expected Result:",
            "  - The workflow completes successfully and the user lands in the correct state.",
            "",
            f"### {edge_title}",
            "- Description: Exercises failure handling, invalid state, and recovery paths around the same user journey.",
            "- Priority: medium",
            "- Steps:",
            "  - Repeat the workflow with invalid, partial, expired, or repeated inputs.",
            "  - Observe validation, recovery, and user-facing errors.",
            "- Expected Result:",
            "  - The system fails safely, communicates the issue clearly, and avoids inconsistent state.",
        ]
    ).strip()


def parse_scenario_suggestions(content: str) -> list[dict[str, str]]:
    normalized = normalize_scenario_suggestions_markdown(content)
    normalized = re.sub(r"(?m)^##\s+Scenario Suggestions\s*$", "", normalized).strip()
    sections = list(
        re.finditer(r"(?ms)^###\s+(.+?)\s*$([\s\S]*?)(?=^###\s+|\Z)", normalized)
    )
    parsed: list[dict[str, str]] = []

    for section in sections:
        title = section.group(1).strip()
        body = section.group(2)
        description_match = re.search(
            r"(?ims)^\s*[-*]?\s*Description:\s*(.*?)(?=^\s*[-*]?\s*Priority:|^\s*[-*]?\s*Steps:|^\s*[-*]?\s*Expected Result:|\Z)",
            body,
        )
        priority_match = re.search(
            r"(?im)^\s*[-*]?\s*Priority:\s*(low|medium|high|critical)\s*$", body
        )
        steps_match = re.search(
            r"(?ims)^\s*[-*]?\s*Steps:\s*(.*?)(?=^\s*[-*]?\s*Expected Result:|\Z)", body
        )
        expected_match = re.search(r"(?ims)^\s*[-*]?\s*Expected Result:\s*(.*)$", body)

        steps = ""
        if steps_match:
            step_lines = [
                re.sub(r"^\s*[-*]\s*", "", line).strip()
                for line in steps_match.group(1).splitlines()
                if line.strip()
            ]
            steps = "\n".join(line for line in step_lines if line)

        expected_result = ""
        if expected_match:
            expected_lines = [
                re.sub(r"^\s*[-*]\s*", "", line).strip()
                for line in expected_match.group(1).splitlines()
                if line.strip()
            ]
            expected_result = "\n".join(line for line in expected_lines if line)

        description = ""
        if description_match:
            description_lines = [
                re.sub(r"^\s*[-*]\s*", "", line).strip()
                for line in description_match.group(1).splitlines()
                if line.strip()
            ]
            description = " ".join(line for line in description_lines if line)

        scenario = {
            "title": title[:200],
            "description": description,
            "steps": steps,
            "expected_result": expected_result,
            "priority": (
                priority_match.group(1).lower() if priority_match else "medium"
            ),
        }
        if _is_valid_scenario_suggestion(scenario):
            parsed.append(scenario)

    if parsed:
        return [scenario for scenario in parsed if scenario["title"]][:3]

    return []


def _is_valid_scenario_suggestion(scenario: dict[str, str]) -> bool:
    title = scenario["title"].strip()
    if not title or INVALID_SCENARIO_TITLE_PATTERN.match(title):
        return False
    if title.lower() in {"scenario suggestions", "priority", "steps", "expected result"}:
        return False
    if not scenario["description"].strip():
        return False
    if not scenario["steps"].strip():
        return False
    if not scenario["expected_result"].strip():
        return False
    return True
