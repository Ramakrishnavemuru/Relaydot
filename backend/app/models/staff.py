from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, LargeBinary, Index
from app.database import Base


def now():
    return datetime.now(timezone.utc)


class SupportCase(Base):
    __tablename__ = "support_cases"
    id = Column(Integer, primary_key=True)
    reporter_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(16), nullable=False, index=True)
    category = Column(String(32), nullable=False)
    title = Column(String(160), nullable=False)
    description = Column(Text, nullable=False)
    steps = Column(Text)
    expected = Column(Text)
    actual = Column(Text)
    attachment_url = Column(String(500))
    rating = Column(Integer)
    diagnostics = Column(Text)
    app_version = Column(String(40), default="1.0.0", nullable=False)
    status = Column(String(20), default="NEW", nullable=False, index=True)
    priority = Column(String(12), default="NORMAL", nullable=False, index=True)
    assigned_to_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), index=True)
    duplicate_of_id = Column(Integer, ForeignKey("support_cases.id", ondelete="SET NULL"))
    legacy_feedback_id = Column(Integer, unique=True)
    created_at = Column(DateTime, default=now, nullable=False, index=True)
    updated_at = Column(DateTime, default=now, onupdate=now, nullable=False)
    __table_args__ = (Index("ix_support_cases_queue", "kind", "status", "created_at"),)


class CaseMessage(Base):
    __tablename__ = "case_messages"
    id = Column(Integer, primary_key=True)
    case_id = Column(Integer, ForeignKey("support_cases.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    body = Column(Text, nullable=False)
    internal = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=now, nullable=False)


class CaseAttachment(Base):
    __tablename__ = "case_attachments"
    id = Column(Integer, primary_key=True)
    case_id = Column(Integer, ForeignKey("support_cases.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name = Column(String(120), nullable=False)
    mime_type = Column(String(40), nullable=False)
    size = Column(Integer, nullable=False)
    data = Column(LargeBinary, nullable=False)
    created_at = Column(DateTime, default=now, nullable=False)


class StaffNotification(Base):
    __tablename__ = "staff_notifications"
    id = Column(Integer, primary_key=True)
    recipient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    event = Column(String(32), nullable=False)
    target_type = Column(String(24), nullable=False)
    target_id = Column(Integer, nullable=False)
    title = Column(String(160), nullable=False)
    read_at = Column(DateTime)
    created_at = Column(DateTime, default=now, nullable=False)


class ModeratorAuditLog(Base):
    __tablename__ = "moderator_audit_logs"
    id = Column(Integer, primary_key=True)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action = Column(String(64), nullable=False, index=True)
    target_type = Column(String(32), nullable=False)
    target_id = Column(Integer)
    result = Column(String(16), nullable=False, default="SUCCESS")
    reason = Column(String(500))
    created_at = Column(DateTime, default=now, nullable=False, index=True)


class StaffInvitation(Base):
    __tablename__ = "staff_invitations"
    id = Column(Integer, primary_key=True)
    email = Column(String(120), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    invited_by_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"))
    expires_at = Column(DateTime, nullable=False)
    accepted_at = Column(DateTime)
    created_at = Column(DateTime, default=now, nullable=False)


class ModerationAction(Base):
    __tablename__ = "moderation_actions"
    id = Column(Integer, primary_key=True)
    actor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=False)
    target_user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    action = Column(String(24), nullable=False)
    reason = Column(String(500), nullable=False)
    expires_at = Column(DateTime)
    created_at = Column(DateTime, default=now, nullable=False)


class Appeal(Base):
    __tablename__ = "moderation_appeals"
    id = Column(Integer, primary_key=True)
    action_id = Column(Integer, ForeignKey("moderation_actions.id", ondelete="CASCADE"), nullable=False, unique=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    body = Column(Text, nullable=False)
    status = Column(String(16), nullable=False, default="OPEN")
    created_at = Column(DateTime, default=now, nullable=False)
