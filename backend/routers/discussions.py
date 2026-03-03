from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.database import get_db
from backend.models import Message, Scenario, Topic
from backend.schemas import (
    MessageCreate,
    MessageRead,
    ScenarioRead,
    ScenarioSuggestionsCreate,
    ScenarioSuggestionsRead,
    TopicCreate,
    TopicRead,
    TopicSummary,
)
from backend.services.agno_agents.scenario_agent import (
    ScenarioGeneratorAgent,
    build_fallback_scenario_suggestions,
    normalize_scenario_suggestions_markdown,
    parse_scenario_suggestions,
)
from backend.services.enrichment_service import enqueue_enrichment


router = APIRouter(tags=["Discussions"])
settings = get_settings()


@router.post("/topics", response_model=TopicRead, status_code=status.HTTP_201_CREATED)
def create_topic(payload: TopicCreate, db: Session = Depends(get_db)) -> Topic:
    topic = Topic(title=payload.title)
    db.add(topic)
    db.commit()
    db.refresh(topic)
    return topic


@router.get("/topics", response_model=list[TopicSummary])
def list_topics(db: Session = Depends(get_db)) -> list[TopicSummary]:
    stmt = (
        select(
            Topic.id,
            Topic.title,
            Topic.created_at,
            func.count(Message.id).label("message_count"),
            func.sum(
                case((Message.enriched_content.is_not(None), 1), else_=0)
            ).label("enriched_message_count"),
            func.max(Message.created_at).label("last_message_at"),
        )
        .outerjoin(Message, Message.topic_id == Topic.id)
        .group_by(Topic.id)
        .order_by(
            func.coalesce(func.max(Message.created_at), Topic.created_at).desc(),
            Topic.id.desc(),
        )
    )
    rows = db.execute(stmt).all()
    return [TopicSummary.model_validate(row._mapping) for row in rows]


@router.post(
    "/topics/{topic_id}/messages",
    response_model=MessageRead,
    status_code=status.HTTP_201_CREATED,
)
def create_message(
    topic_id: int,
    payload: MessageCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> Message:
    topic = db.get(Topic, topic_id)
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found.")

    message = Message(topic_id=topic_id, content=payload.content)
    db.add(message)
    db.commit()
    db.refresh(message)

    if settings.sync_enrichment:
        enqueue_enrichment(message.id)
        db.refresh(message)
    else:
        background_tasks.add_task(enqueue_enrichment, message.id)

    return message


@router.get("/topics/{topic_id}/messages", response_model=list[MessageRead])
def list_messages(topic_id: int, db: Session = Depends(get_db)) -> list[Message]:
    topic = db.get(Topic, topic_id)
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found.")

    stmt = (
        select(Message)
        .where(Message.topic_id == topic_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
    )
    return list(db.scalars(stmt).all())


@router.post(
    "/topics/{topic_id}/scenario-suggestions",
    response_model=ScenarioSuggestionsRead,
)
def generate_scenario_suggestions(
    topic_id: int, db: Session = Depends(get_db)
) -> ScenarioSuggestionsRead:
    topic = db.get(Topic, topic_id)
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found.")

    stmt = (
        select(Message)
        .where(Message.topic_id == topic_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
    )
    messages = list(db.scalars(stmt).all())
    if not messages:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add at least one message before generating scenarios.",
        )

    discussion_prompt = "\n".join(f"- {message.content}" for message in messages)

    try:
        content = ScenarioGeneratorAgent(db=db, topic_id=topic_id).generate(
            discussion_prompt
        )
    except Exception:
        content = build_fallback_scenario_suggestions(discussion_prompt)

    content = normalize_scenario_suggestions_markdown(content)
    scenarios = parse_scenario_suggestions(content)
    if not scenarios:
        content = build_fallback_scenario_suggestions(discussion_prompt)
        scenarios = parse_scenario_suggestions(content)

    return ScenarioSuggestionsRead(content=content, scenarios=scenarios)


@router.post(
    "/topics/{topic_id}/scenario-suggestions/save",
    response_model=list[ScenarioRead],
    status_code=status.HTTP_201_CREATED,
)
def save_generated_scenarios(
    topic_id: int,
    payload: ScenarioSuggestionsCreate,
    db: Session = Depends(get_db),
) -> list[Scenario]:
    topic = db.get(Topic, topic_id)
    if topic is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found.")

    parsed_scenarios = parse_scenario_suggestions(payload.content)
    if not parsed_scenarios:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Unable to parse generated scenarios.",
        )

    created: list[Scenario] = []
    for payload in parsed_scenarios:
        scenario = Scenario(**payload)
        db.add(scenario)
        created.append(scenario)

    db.commit()
    for scenario in created:
        db.refresh(scenario)
    return created
