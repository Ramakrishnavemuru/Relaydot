from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from app.database import Base


class PostMedia(Base):
    __tablename__ = "post_media"

    id = Column(String(32), primary_key=True, default=lambda: uuid4().hex)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    post_id = Column(Integer, ForeignKey("posts.id", ondelete="SET NULL"), index=True)
    stored_name = Column(String(64), nullable=False, unique=True)
    file_name = Column(String(255), nullable=False)
    content_type = Column(String(100), nullable=False)
    media_type = Column(String(12), nullable=False)
    file_size = Column(Integer, nullable=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
