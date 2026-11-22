from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    dm_policy = Column(String(12), nullable=False, default="EVERYONE")
    group_invite_policy = Column(String(12), nullable=False, default="EVERYONE")
    story_audience = Column(String(12), nullable=False, default="EVERYONE")
    notifications_enabled = Column(Boolean, nullable=False, default=True)
    direct_notifications = Column(Boolean, nullable=False, default=True)
    group_notifications = Column(Boolean, nullable=False, default=True)
    story_notifications = Column(Boolean, nullable=False, default=True)
    notification_preview = Column(Boolean, nullable=False, default=True)
    notification_sound = Column(Boolean, nullable=False, default=True)
    dnd_until = Column(DateTime, nullable=True)
    enter_to_send = Column(Boolean, nullable=False, default=True)
    chat_text_size = Column(String(12), nullable=False, default="NORMAL")
    chat_wallpaper = Column(String(16), nullable=False, default="DEFAULT")
    auto_download_images = Column(Boolean, nullable=False, default=True)
    auto_download_videos = Column(Boolean, nullable=False, default=False)
    media_quality = Column(String(12), nullable=False, default="STANDARD")
    call_ringtone = Column(Boolean, nullable=False, default=True)
    call_notifications = Column(Boolean, nullable=False, default=True)
    accent = Column(String(12), nullable=False, default="INDIGO")
    density = Column(String(12), nullable=False, default="COMFORTABLE")
    reduced_motion = Column(Boolean, nullable=False, default=False)
    high_contrast = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    user = relationship("User", back_populates="settings")


class ContactChange(Base):
    __tablename__ = "contact_changes"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(8), nullable=False)
    new_value = Column(String(120), nullable=False)
    code_hash = Column(String(128), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(12), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
