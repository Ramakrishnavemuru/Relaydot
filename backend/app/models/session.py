import secrets
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class UserSession(Base):
    __tablename__ = "user_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(64), unique=True, index=True, nullable=False, default=lambda: secrets.token_hex(24))
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_name = Column(String(120), nullable=True, default="Unknown Device")
    ip_address = Column(String(45), nullable=True)
    user_agent = Column(Text, nullable=True)
    refresh_token_hash = Column(String(128), index=True, nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    last_active = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    revoked = Column(Boolean, default=False, nullable=False)
    revoked_at = Column(DateTime, nullable=True)

    # Relationship
    user = relationship("User", back_populates="sessions")

    def to_dict(self, current_session_id: str = None):
        return {
            "session_id": self.session_id,
            "device_name": self.device_name or "Unknown Device",
            "ip_address": self.ip_address,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_active": self.last_active.isoformat() if self.last_active else None,
            "is_current": bool(current_session_id and self.session_id == current_session_id),
            "revoked": self.revoked
        }
