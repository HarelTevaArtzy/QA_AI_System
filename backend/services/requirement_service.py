from __future__ import annotations

from backend.config import get_settings
from backend.models import Requirement
from backend.services.agno_agents.model_factory import build_model
from backend.services.agno_agents.scenario_agent import (
    build_fallback_scenario_suggestions,
    normalize_scenario_suggestions_markdown,
)


def build_requirement_prompt(requirement: Requirement) -> str:
    child_titles = [child.title.strip() for child in requirement.children if child.title.strip()]
    lines = [
        f"Requirement: {requirement.title}",
        f"Description: {requirement.description or 'No detailed description provided.'}",
    ]
    if child_titles:
        lines.append("Child requirements:")
        lines.extend(f"- {title}" for title in child_titles)
    return "\n".join(lines)


def build_requirement_scenario_suggestions(requirement: Requirement) -> str:
    settings = get_settings()
    prompt = build_requirement_prompt(requirement)

    if settings.agno_provider == "disabled":
        return build_requirement_fallback_suggestions(requirement)

    try:
        from agno.agent import Agent

        agent = Agent(
            model=build_model(settings),
            description="You convert QA requirements into structured scenario suggestions.",
            instructions=[
                "Generate candidate QA scenarios directly from the requirement content.",
                "Your output must begin with exactly '## Scenario Suggestions'.",
                "Generate only the number of scenarios that are necessary, with a hard maximum of 3.",
                "For each scenario, use a '### <title>' heading followed by Description, Priority, Steps, and Expected Result fields.",
                "Focus on traceable requirement coverage, edge conditions, and failure handling.",
                "Do not include JSON, reasoning, or any preamble before the markdown sections.",
            ],
            markdown=True,
        )
        result = agent.run(prompt)
        content = normalize_scenario_suggestions_markdown(getattr(result, "content", str(result)))
        status = getattr(result, "status", None)
        status_value = getattr(status, "value", str(status or "")).lower()
        if status_value == "error" or not content.strip():
            raise RuntimeError("Requirement scenario generation failed.")
        return content
    except Exception:
        return build_requirement_fallback_suggestions(requirement)


def build_requirement_fallback_suggestions(requirement: Requirement) -> str:
    title = requirement.title.strip() or "Requirement"
    child_titles = [child.title.strip() for child in requirement.children if child.title.strip()]
    child_line = (
        f"Validate the related child requirements: {', '.join(child_titles[:3])}."
        if child_titles
        else "Validate the primary workflow defined by the requirement."
    )

    return "\n".join(
        [
            "## Scenario Suggestions",
            "",
            f"### Mainline coverage: {title}",
            "- Description: Verifies the core requirement succeeds in the expected business flow and produces the intended outcome.",
            "- Priority: high",
            "- Steps:",
            "  - Prepare the system with the prerequisite data and permissions needed for the requirement.",
            f"  - Execute the primary workflow for '{title}'.",
            f"  - {child_line}",
            "- Expected Result:",
            f"  - The system satisfies the requirement '{title}' without unexpected errors or data inconsistencies.",
            "  - Any related downstream state changes are applied correctly.",
            "",
            f"### Negative and boundary coverage: {title}",
            "- Description: Exercises invalid data, missing prerequisites, and boundary conditions around the same requirement.",
            "- Priority: medium",
            "- Steps:",
            "  - Repeat the workflow with invalid, incomplete, duplicate, or out-of-sequence inputs.",
            "  - Observe validation, error handling, and recovery behavior.",
            "- Expected Result:",
            "  - The system prevents invalid processing, explains the failure clearly, and preserves a consistent state.",
        ]
    ).strip()


def build_requirement_discussion_seed(requirement: Requirement) -> str:
    prompt = build_requirement_prompt(requirement)
    return build_fallback_scenario_suggestions(prompt)
