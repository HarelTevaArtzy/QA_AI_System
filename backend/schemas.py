from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.security import ROLE_VALUES, normalize_role, normalize_username


PriorityValue = Literal["low", "medium", "high", "critical"]
UserRoleValue = Literal["admin", "qa", "viewer"]


def _normalize_required_text(value: str, error_message: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(error_message)
    return normalized


def _normalize_optional_text(value: str) -> str:
    return value.strip()


class RequirementSummaryRead(BaseModel):
    id: int
    title: str
    parent_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class ScenarioSummaryRead(BaseModel):
    id: int
    title: str
    priority: PriorityValue
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ScenarioBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="")
    steps: str = Field(default="")
    expected_result: str = Field(default="")
    priority: PriorityValue = "medium"

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return _normalize_required_text(value, "Title must not be empty.")

    @field_validator("description", "steps", "expected_result")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return _normalize_optional_text(value)


class ScenarioCreate(ScenarioBase):
    requirement_ids: list[int] = Field(default_factory=list)


class ScenarioUpdate(ScenarioCreate):
    pass


class ScenarioRead(ScenarioBase):
    id: int
    created_at: datetime
    requirements: list[RequirementSummaryRead] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class RequirementBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="")
    parent_id: int | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return _normalize_required_text(value, "Requirement title must not be empty.")

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        return _normalize_optional_text(value)


class RequirementCreate(RequirementBase):
    pass


class RequirementUpdate(RequirementBase):
    pass


class RequirementScenarioCreate(ScenarioBase):
    pass


class RequirementTreeRead(BaseModel):
    id: int
    title: str
    description: str
    parent_id: int | None
    created_at: datetime
    scenario_count: int = 0
    children: list["RequirementTreeRead"] = Field(default_factory=list)


class RequirementRead(BaseModel):
    id: int
    title: str
    description: str
    parent_id: int | None
    created_at: datetime
    parent: RequirementSummaryRead | None = None
    children: list[RequirementSummaryRead] = Field(default_factory=list)
    scenarios: list[ScenarioSummaryRead] = Field(default_factory=list)


RequirementTreeRead.model_rebuild()


class TopicCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return _normalize_required_text(value, "Topic title must not be empty.")


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
        return _normalize_required_text(value, "Message content must not be empty.")


class MessageRead(BaseModel):
    id: int
    topic_id: int
    sender_name: str
    content: str
    enriched_content: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ScenarioSuggestionsRead(BaseModel):
    content: str
    scenarios: list[ScenarioCreate] = Field(default_factory=list)


class ScenarioSuggestionsCreate(BaseModel):
    content: str = Field(..., min_length=1)

    @field_validator("content")
    @classmethod
    def normalize_content(cls, value: str) -> str:
        return _normalize_required_text(value, "Scenario suggestions must not be empty.")


class AuthLogin(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=200)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        return normalize_username(value)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return _normalize_required_text(value, "Password must not be empty.")


class UserBase(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    role: UserRoleValue = "viewer"

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        return normalize_username(value)

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str) -> str:
        return normalize_role(value)


class UserCreate(UserBase):
    password: str = Field(..., min_length=6, max_length=200)

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return _normalize_required_text(value, "Password must not be empty.")


class UserUpdate(UserBase):
    password: str | None = Field(default=None, min_length=6, max_length=200)

    @field_validator("password")
    @classmethod
    def validate_optional_password(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_required_text(value, "Password must not be empty.")


class UserRead(BaseModel):
    id: int
    username: str
    role: UserRoleValue
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuthTokenRead(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserRead


if set(ROLE_VALUES) != {"admin", "qa", "viewer"}:
    raise RuntimeError("Schema role literals and security roles are out of sync.")
