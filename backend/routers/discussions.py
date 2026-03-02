from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.database import get_db
from backend.models import Message, Topic
from backend.schemas import MessageCreate, MessageRead, TopicCreate, TopicRead, TopicSummary
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
