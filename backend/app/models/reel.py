"""Short-form video records. Social graph and hashtag identities are shared with posts."""
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from app.database import Base


def now():
    return datetime.now(timezone.utc)


class Reel(Base):
    __tablename__ = "reels"
    id = Column(Integer, primary_key=True)
    public_id = Column(String(32), unique=True, nullable=False, index=True)
    creator_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    caption = Column(Text, default="", nullable=False)
    visibility = Column(String(12), default="EVERYONE", nullable=False, index=True)
    status = Column(String(16), default="PROCESSING", nullable=False, index=True)
    publish_requested = Column(Boolean, default=True, nullable=False)
    allow_comments = Column(Boolean, default=True, nullable=False)
    allow_download = Column(Boolean, default=False, nullable=False)
    source_path = Column(String(500), nullable=False)
    video_path = Column(String(500))
    thumbnail_path = Column(String(500))
    duration = Column(Float)
    width = Column(Integer)
    height = Column(Integer)
    error = Column(String(255))
    processing_started_at = Column(DateTime)
    created_at = Column(DateTime, default=now, nullable=False, index=True)
    updated_at = Column(DateTime, default=now, onupdate=now, nullable=False)
    published_at = Column(DateTime, index=True)
    deleted_at = Column(DateTime)
    __table_args__ = (Index("ix_reels_feed", "status", "visibility", "published_at"),)


class ReelLike(Base):
    __tablename__ = "reel_likes"
    id = Column(Integer, primary_key=True)
    reel_id = Column(Integer, ForeignKey("reels.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=now, nullable=False)
    __table_args__ = (UniqueConstraint("reel_id", "user_id"),)


class ReelBookmark(Base):
    __tablename__ = "reel_bookmarks"
    id = Column(Integer, primary_key=True)
    reel_id = Column(Integer, ForeignKey("reels.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=now, nullable=False)
    __table_args__ = (UniqueConstraint("reel_id", "user_id"),)


class ReelComment(Base):
    __tablename__ = "reel_comments"
    id = Column(Integer, primary_key=True)
    reel_id = Column(Integer, ForeignKey("reels.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("reel_comments.id", ondelete="CASCADE"), index=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=now, nullable=False, index=True)
    pinned_at = Column(DateTime)
    deleted_at = Column(DateTime)


class ReelCommentLike(Base):
    __tablename__ = "reel_comment_likes"
    id = Column(Integer, primary_key=True)
    comment_id = Column(Integer, ForeignKey("reel_comments.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    __table_args__ = (UniqueConstraint("comment_id", "user_id"),)


class ReelView(Base):
    __tablename__ = "reel_views"
    id = Column(Integer, primary_key=True)
    reel_id = Column(Integer, ForeignKey("reels.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    session_id = Column(String(36), nullable=False)
    watched_ms = Column(Integer, default=0, nullable=False)
    completed = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=now, nullable=False)
    __table_args__ = (UniqueConstraint("reel_id", "user_id", "session_id"),)


class ReelShare(Base):
    __tablename__ = "reel_shares"
    id = Column(Integer, primary_key=True)
    reel_id = Column(Integer, ForeignKey("reels.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="SET NULL"), index=True)
    created_at = Column(DateTime, default=now, nullable=False)


class ReelHashtag(Base):
    __tablename__ = "reel_hashtags"
    id = Column(Integer, primary_key=True)
    reel_id = Column(Integer, ForeignKey("reels.id", ondelete="CASCADE"), nullable=False, index=True)
    hashtag_id = Column(Integer, ForeignKey("hashtags.id", ondelete="CASCADE"), nullable=False, index=True)
    __table_args__ = (UniqueConstraint("reel_id", "hashtag_id"),)


class ReelMention(Base):
    __tablename__ = "reel_mentions"
    id = Column(Integer, primary_key=True)
    reel_id = Column(Integer, ForeignKey("reels.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    __table_args__ = (UniqueConstraint("reel_id", "user_id"),)
