from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Boolean, Index
from sqlalchemy.orm import relationship
from app.database import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(String(20), nullable=False, default="DIRECT")  # DIRECT or GROUP
    name = Column(String(100), nullable=True)  # Name for group chats
    avatar_url = Column(String(500), nullable=True)
    description = Column(Text, nullable=True)
    created_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    members = relationship("ConversationMember", back_populates="conversation", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="conversation", cascade="all, delete-orphan")
    created_by = relationship("User", foreign_keys=[created_by_id])


class ConversationMember(Base):
    __tablename__ = "conversation_members"
    __table_args__ = (Index("ix_conversation_members_user_conversation", "user_id", "conversation_id"),
                      Index("ix_conversation_members_conversation_user", "conversation_id", "user_id"))

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(Integer, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(20), default="MEMBER")  # ADMIN or MEMBER
    joined_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    last_read_message_id = Column(Integer, nullable=True)
    is_muted = Column(Boolean, default=False)
    muted_until = Column(DateTime, nullable=True)
    mute_calls = Column(Boolean, default=False, nullable=False)
    is_pinned = Column(Boolean, default=False, nullable=False)
    is_archived = Column(Boolean, default=False, nullable=False)
    is_favourite = Column(Boolean, default=False, nullable=False)
    is_hidden = Column(Boolean, default=False, nullable=False)
    cleared_before_message_id = Column(Integer, default=0, nullable=False)
    lock_pin_hash = Column(String(200), nullable=True)
    lock_version = Column(String(40), nullable=True)

    # Relationships
    conversation = relationship("Conversation", back_populates="members")
    user = relationship("User", back_populates="memberships")
