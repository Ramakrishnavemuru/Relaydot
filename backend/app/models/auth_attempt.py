from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, Integer, String, Index
from app.database import Base


class AuthAttempt(Base):
    __tablename__ = "auth_attempts"
    id = Column(Integer, primary_key=True)
    ip_hash = Column(String(64), nullable=False)
    subject_hash = Column(String(64), nullable=False)
    action = Column(String(24), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    __table_args__ = (Index("ix_auth_attempt_window", "action", "ip_hash", "subject_hash", "created_at"),)
