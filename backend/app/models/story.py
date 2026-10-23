from datetime import datetime, timezone, timedelta
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class Story(Base):
    __tablename__ = "stories"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    media_url = Column(String(500), nullable=False)
    media_type = Column(String(20), default="IMAGE")  # IMAGE, VIDEO, TEXT
    caption = Column(Text, nullable=True)
    visibility = Column(String(12), default="EVERYONE", nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc) + timedelta(hours=24),
        nullable=False,
        index=True
    )

    # Relationships
    user = relationship("User", backref="stories")
    views = relationship("StoryView", back_populates="story", cascade="all, delete-orphan")
