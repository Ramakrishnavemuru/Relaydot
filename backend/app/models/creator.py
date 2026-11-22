"""Creator analytics and server-owned scheduled posts."""
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint
from app.database import Base


def now():
    return datetime.now(timezone.utc)


class CreatorEvent(Base):
    __tablename__ = "creator_events"
    id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    event_type = Column(String(24), nullable=False)
    content_type = Column(String(12))
    content_id = Column(Integer)
    audience_kind = Column(String(16), nullable=False, default="UNKNOWN")
    day = Column(Date, nullable=False)
    created_at = Column(DateTime, default=now, nullable=False)
    dedupe_key = Column(String(100), unique=True)
    __table_args__ = (
        Index("ix_creator_events_owner_day_type", "owner_id", "day", "event_type"),
        Index("ix_creator_events_content_day", "content_type", "content_id", "day"),
    )


class ScheduledPost(Base):
    __tablename__ = "scheduled_posts"
    id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    client_id = Column(String(36), nullable=False)
    payload = Column(JSON, nullable=False)
    scheduled_at = Column(DateTime, nullable=False, index=True)
    next_attempt_at = Column(DateTime, nullable=False)
    status = Column(String(16), nullable=False, default="SCHEDULED")
    attempts = Column(Integer, nullable=False, default=0)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="SET NULL"))
    error = Column(String(200))
    created_at = Column(DateTime, default=now, nullable=False)
    updated_at = Column(DateTime, default=now, onupdate=now, nullable=False)
    __table_args__ = (
        UniqueConstraint("owner_id", "client_id", name="uq_scheduled_post_owner_client"),
        Index("ix_scheduled_posts_due", "status", "next_attempt_at"),
    )
