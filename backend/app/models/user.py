from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
from sqlalchemy.orm import relationship
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    email = Column(String(120), unique=True, index=True, nullable=True)
    phone_number = Column(String(30), unique=True, index=True, nullable=True)
    password_hash = Column(String(255), nullable=True)
    display_name = Column(String(100), nullable=True)
    avatar_url = Column(String(500), nullable=True)
    bio = Column(Text, nullable=True)
    cover_url = Column(String(500), nullable=True)
    website = Column(String(500), nullable=True)
    last_seen = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=True)
    is_online = Column(Boolean, default=False)
    is_verified = Column(Boolean, default=False, nullable=False)

    # 2FA
    totp_secret = Column(String(64), nullable=True)
    totp_enabled = Column(Boolean, default=False, nullable=False)

    # Privacy settings
    show_last_seen = Column(Boolean, default=True)
    show_online = Column(Boolean, default=True)
    show_read_receipts = Column(Boolean, default=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    # Relationships
    memberships = relationship("ConversationMember", back_populates="user", cascade="all, delete-orphan")
    messages = relationship("Message", back_populates="sender", cascade="all, delete-orphan", foreign_keys="Message.sender_id")
    reactions = relationship("MessageReaction", back_populates="user", cascade="all, delete-orphan")
    message_reads = relationship("MessageRead", back_populates="user", cascade="all, delete-orphan")
    blocked = relationship("BlockedUser", foreign_keys="BlockedUser.blocker_id", back_populates="blocker", cascade="all, delete-orphan")
    blocked_by = relationship("BlockedUser", foreign_keys="BlockedUser.blocked_id", back_populates="blocked", cascade="all, delete-orphan")
    sessions = relationship("UserSession", back_populates="user", cascade="all, delete-orphan")
    passkeys = relationship("Passkey", back_populates="user", cascade="all, delete-orphan")
    recovery_codes = relationship("RecoveryCode", back_populates="user", cascade="all, delete-orphan")

    def to_dict(self, include_sensitive=False):
        data = {
            "id": self.id,
            "username": self.username,
            "email": self.email if include_sensitive else None,
            "phone_number": self.phone_number if include_sensitive else None,
            "display_name": self.display_name or self.username,
            "avatar_url": self.avatar_url,
            "bio": self.bio,
            "cover_url": self.cover_url,
            "website": self.website,
            "is_online": self.is_online if self.show_online else False,
            "is_verified": self.is_verified,
            "totp_enabled": self.totp_enabled,
            "has_password": bool(self.password_hash),
            "last_seen": self.last_seen.isoformat() if self.last_seen and self.show_last_seen else None,
            "show_last_seen": self.show_last_seen,
            "show_online": self.show_online,
            "show_read_receipts": self.show_read_receipts,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }
        if not include_sensitive:
            data.pop("email", None)
            data.pop("phone_number", None)
            data.pop("show_last_seen", None)
            data.pop("show_online", None)
            data.pop("show_read_receipts", None)
        return data
