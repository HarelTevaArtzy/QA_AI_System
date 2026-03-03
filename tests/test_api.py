from __future__ import annotations

import os
import re
import uuid
from pathlib import Path


TEST_DB_FILE = Path(__file__).resolve().parent / f"test-{uuid.uuid4().hex}.db"
os.environ["DATABASE_FILE"] = str(TEST_DB_FILE)
os.environ["AGNO_PROVIDER"] = "disabled"

from fastapi.testclient import TestClient

from backend.database import engine
from backend.main import app
from backend.services.agno_agents.scenario_agent import parse_scenario_suggestions


def teardown_module() -> None:
    engine.dispose()
    if TEST_DB_FILE.exists():
        TEST_DB_FILE.unlink()


def test_scenario_crud_and_exports() -> None:
    with TestClient(app) as client:
        payload = {
            "title": "Checkout blocks duplicate payment",
            "description": "Regression coverage for duplicate payment retries.",
            "steps": "Open checkout\nSubmit payment\nClick submit again",
            "expected_result": "Second submission is blocked\nNo duplicate charge occurs",
            "priority": "critical",
        }

        created = client.post("/scenarios", json=payload)
        assert created.status_code == 201
        scenario_id = created.json()["id"]

        listed = client.get("/scenarios")
        assert listed.status_code == 200
        assert len(listed.json()) == 1

        lower_priority = client.post(
            "/scenarios",
            json={
                **payload,
                "title": "Minor UI typo",
                "priority": "low",
            },
        )
        assert lower_priority.status_code == 201

        ordered = client.get("/scenarios")
        assert ordered.status_code == 200
        ordered_payload = ordered.json()
        assert ordered_payload[0]["priority"] == "critical"
        assert ordered_payload[-1]["priority"] == "low"

        updated = client.put(
            f"/scenarios/{scenario_id}",
            json={**payload, "priority": "high"},
        )
        assert updated.status_code == 200
        assert updated.json()["priority"] == "high"

        excel = client.get("/export/scenarios/excel")
        assert excel.status_code == 200
        assert excel.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

        word = client.get("/export/scenarios/word")
        assert word.status_code == 200
        assert word.headers["content-type"].startswith(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )


def test_discussion_storage_and_enrichment_fallback() -> None:
    with TestClient(app) as client:
        scenario = client.post(
            "/scenarios",
            json={
                "title": "Login redirects to homepage",
                "description": "Verify successful login lands on the homepage.",
                "steps": "Open login\nEnter valid credentials\nSubmit form",
                "expected_result": "User lands on the homepage",
                "priority": "high",
            },
        )
        assert scenario.status_code == 201

        topic = client.post("/topics", json={"title": "Password reset failures"})
        assert topic.status_code == 201
        topic_id = topic.json()["id"]

        created_message = client.post(
            f"/topics/{topic_id}/messages",
            json={
                "content": (
                    "Users cannot login after password reset and some requests "
                    "time out during authentication."
                )
            },
        )
        assert created_message.status_code == 201

        topics = client.get("/topics")
        assert topics.status_code == 200
        assert topics.json()[0]["enriched_message_count"] >= 1

        messages = client.get(f"/topics/{topic_id}/messages")
        assert messages.status_code == 200
        payload = messages.json()
        assert len(payload) == 1
        assert payload[0]["enriched_content"]
        assert payload[0]["enriched_content"].startswith("## Summary")
        assert "Fallback enrichment used" not in payload[0]["enriched_content"]
        assert "## Test Type Classification" not in payload[0]["enriched_content"]
        assert "## Test Ideas" in payload[0]["enriched_content"]
        assert " - functional" in payload[0]["enriched_content"]
        test_ideas_match = re.search(
            r"(?ms)^## Test Ideas\s*(.*?)(?=^##\s|\Z)",
            payload[0]["enriched_content"],
        )
        assert test_ideas_match is not None
        assert "[" not in test_ideas_match.group(1)
        assert "## Related Scenarios" in payload[0]["enriched_content"]
        assert "## QA Heuristics" in payload[0]["enriched_content"]
        assert payload[0]["enriched_content"].count("## QA Heuristics") == 1
        assert "Login redirects to homepage" in payload[0]["enriched_content"]


def test_scenario_suggestions_endpoint() -> None:
    with TestClient(app) as client:
        topic = client.post("/topics", json={"title": "Login failures"})
        assert topic.status_code == 201
        topic_id = topic.json()["id"]

        message = client.post(
            f"/topics/{topic_id}/messages",
            json={"content": "Users log in successfully but do not reach the homepage."},
        )
        assert message.status_code == 201

        suggestions = client.post(f"/topics/{topic_id}/scenario-suggestions")
        assert suggestions.status_code == 200
        payload = suggestions.json()
        content = payload["content"]
        assert "## Scenario Suggestions" in content
        assert "Regression scenario" in content
        assert len(payload["scenarios"]) >= 1
        assert len(payload["scenarios"]) <= 3
        assert all(item["title"] for item in payload["scenarios"])
        assert all(item["description"] for item in payload["scenarios"])


def test_generate_and_save_scenarios_endpoint() -> None:
    with TestClient(app) as client:
        topic = client.post("/topics", json={"title": "Login failures"})
        assert topic.status_code == 201
        topic_id = topic.json()["id"]

        message = client.post(
            f"/topics/{topic_id}/messages",
            json={"content": "Users log in successfully but do not reach the homepage."},
        )
        assert message.status_code == 201

        suggestions = client.post(f"/topics/{topic_id}/scenario-suggestions")
        assert suggestions.status_code == 200

        saved = client.post(
            f"/topics/{topic_id}/scenario-suggestions/save",
            json={"content": suggestions.json()["content"]},
        )
        assert saved.status_code == 201
        payload = saved.json()
        assert len(payload) >= 1
        assert all(item["title"] for item in payload)

        scenarios = client.get("/scenarios")
        assert scenarios.status_code == 200
        assert len(scenarios.json()) >= len(payload)


def test_parse_scenario_suggestions_rejects_tool_call_only_output() -> None:
    content = """```json
{ "name": "find_related_scenarios", "parameters": { "keyword": "login transfer homepage" } }
```"""

    assert parse_scenario_suggestions(content) == []


def test_parse_scenario_suggestions_rejects_field_fragments() -> None:
    content = """
## Scenario Suggestions

### Scenario 1: Login Transfer Issue
medium
Test Steps

-
Expected Result

-
### Priority: High
medium
Test Steps

-
Expected Result

-
### Steps:
medium
Test Steps

-
Expected Result

-
"""

    assert parse_scenario_suggestions(content) == []


def test_parse_scenario_suggestions_caps_results_to_three() -> None:
    content = """
## Scenario Suggestions

### One
- Description: Mainline scenario
- Priority: high
- Steps:
  - A
- Expected Result:
  - B

### Two
- Description: Backup scenario
- Priority: high
- Steps:
  - A
- Expected Result:
  - B

### Three
- Description: Third scenario
- Priority: high
- Steps:
  - A
- Expected Result:
  - B

### Four
- Description: Fourth scenario
- Priority: high
- Steps:
  - A
- Expected Result:
  - B
"""

    parsed = parse_scenario_suggestions(content)
    assert len(parsed) == 3
