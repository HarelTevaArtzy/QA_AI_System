from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


PriorityValue = Literal["low", "medium", "high", "critical"]


class ScenarioBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="")
    steps: str = Field(default="")
    expected_result: str = Field(default="")
    priority: PriorityValue = "medium"

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Title must not be empty.")
        return normalized

    @field_validator("description", "steps", "expected_result")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return value.strip()


class ScenarioCreate(ScenarioBase):
    pass


class ScenarioUpdate(ScenarioBase):
    pass


class ScenarioRead(ScenarioBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TopicCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Topic title must not be empty.")
        return normalized


class TopicRead(BaseModel):
    id: int
    title: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TopicSummary(TopicRead):
    message_count: int = 0
    enriched_message_count: int = 0
    last_message_at: datetime | None = None


class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1)

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Message content must not be empty.")
        return normalized


class MessageRead(BaseModel):
    id: int
    topic_id: int
    content: str
    enriched_content: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
