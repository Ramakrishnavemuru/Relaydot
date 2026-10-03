"""Social and community records. Existing chat tables remain the source for chat."""
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from app.database import Base


def now():
    return datetime.now(timezone.utc)


class Follow(Base):
    __tablename__ = "follows"
    id = Column(Integer, primary_key=True)
    follower_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    following_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=now, nullable=False)
    __table_args__ = (UniqueConstraint("follower_id", "following_id"),)


class Community(Base):
    __tablename__ = "communities"
    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    description = Column(Text, default="", nullable=False)
    avatar_url = Column(String(500))
    banner_url = Column(String(500))
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="SET NULL"), unique=True)
    created_at = Column(DateTime, default=now, nullable=False)


class CommunityMember(Base):
    __tablename__ = "community_members"
    id = Column(Integer, primary_key=True)
    community_id = Column(Integer, ForeignKey("communities.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(12), default="MEMBER", nullable=False)
    joined_at = Column(DateTime, default=now, nullable=False)
    __table_args__ = (UniqueConstraint("community_id", "user_id"),)


class Post(Base):
    __tablename__ = "posts"
    id = Column(Integer, primary_key=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    community_id = Column(Integer, ForeignKey("communities.id", ondelete="CASCADE"), index=True)
    content = Column(Text, default="", nullable=False)
    media_url = Column(String(500))
    media_type = Column(String(12))
    visibility = Column(String(12), default="EVERYONE", nullable=False)
    reply_policy = Column(String(16), default="EVERYONE", nullable=False)
    repost_of_id = Column(Integer, ForeignKey("posts.id", ondelete="SET NULL"), index=True)
    quote_of_id = Column(Integer, ForeignKey("posts.id", ondelete="SET NULL"), index=True)
    thread_parent_id = Column(Integer, ForeignKey("posts.id", ondelete="SET NULL"), index=True)
    pinned = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=now, nullable=False, index=True)
    updated_at = Column(DateTime, default=now, onupdate=now, nullable=False)
    edited_at = Column(DateTime)
    deleted_at = Column(DateTime)
    author = relationship("User", foreign_keys=[author_id])
    community = relationship("Community", foreign_keys=[community_id])
    repost_of = relationship("Post", remote_side=[id], foreign_keys=[repost_of_id])
    quote_of = relationship("Post", remote_side=[id], foreign_keys=[quote_of_id])
    __table_args__ = (Index("ix_posts_visible_recent", "deleted_at", "created_at"),
                      UniqueConstraint("author_id", "repost_of_id"))


class PostReaction(Base):
    __tablename__ = "post_reactions"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    emoji = Column(String(12), default="❤️", nullable=False)
    created_at = Column(DateTime, default=now, nullable=False)
    __table_args__ = (UniqueConstraint("post_id", "user_id"),)


class Comment(Base):
    __tablename__ = "comments"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id = Column(Integer, ForeignKey("comments.id", ondelete="CASCADE"), index=True)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=now, nullable=False, index=True)
    deleted_at = Column(DateTime)
    author = relationship("User")


class CommentReaction(Base):
    __tablename__ = "comment_reactions"
    id = Column(Integer, primary_key=True)
    comment_id = Column(Integer, ForeignKey("comments.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    __table_args__ = (UniqueConstraint("comment_id", "user_id"),)


class Bookmark(Base):
    __tablename__ = "bookmarks"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=now, nullable=False)
    __table_args__ = (UniqueConstraint("post_id", "user_id"),)


class Hashtag(Base):
    __tablename__ = "hashtags"
    id = Column(Integer, primary_key=True)
    name = Column(String(50), unique=True, nullable=False, index=True)


class PostHashtag(Base):
    __tablename__ = "post_hashtags"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    hashtag_id = Column(Integer, ForeignKey("hashtags.id", ondelete="CASCADE"), nullable=False, index=True)
    __table_args__ = (UniqueConstraint("post_id", "hashtag_id"),)


class PostMention(Base):
    __tablename__ = "post_mentions"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    __table_args__ = (UniqueConstraint("post_id", "user_id"),)


class PollOption(Base):
    __tablename__ = "poll_options"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    label = Column(String(100), nullable=False)
    position = Column(Integer, nullable=False)
    __table_args__ = (UniqueConstraint("post_id", "position"),)


class PollVote(Base):
    __tablename__ = "poll_votes"
    id = Column(Integer, primary_key=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True)
    option_id = Column(Integer, ForeignKey("poll_options.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime, default=now, nullable=False)
    __table_args__ = (UniqueConstraint("post_id", "user_id"),)


class SocialNotification(Base):
    __tablename__ = "social_notifications"
    id = Column(Integer, primary_key=True)
    recipient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(24), nullable=False)
    entity_type = Column(String(16), nullable=False)
    entity_id = Column(Integer, nullable=False)
    read = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=now, nullable=False, index=True)
    actor = relationship("User", foreign_keys=[actor_id])


class Report(Base):
    __tablename__ = "social_reports"
    id = Column(Integer, primary_key=True)
    reporter_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_type = Column(String(16), nullable=False)
    entity_id = Column(Integer, nullable=False)
    reason = Column(String(24), nullable=False)
    details = Column(String(500))
    created_at = Column(DateTime, default=now, nullable=False)
    __table_args__ = (UniqueConstraint("reporter_id", "entity_type", "entity_id"),)
