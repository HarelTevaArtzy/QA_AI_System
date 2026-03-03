from __future__ import annotations

import os
import uuid
from pathlib import Path


TEST_DB_FILE = Path(__file__).resolve().parent / f"test-{uuid.uuid4().hex}.db"
os.environ["DATABASE_FILE"] = str(TEST_DB_FILE)
os.environ["AGNO_PROVIDER"] = "disabled"

from fastapi.testclient import TestClient

from backend.database import engine
from backend.main import app


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
