from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from app.database import Base


class ChatUpload(Base):
    """Private chat media. The opaque ID is never a substitute for membership checks."""

    __tablename__ = "chat_uploads"

    id = Column(String(32), primary_key=True, default=lambda: uuid4().hex)
    uploader_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name = Column(String(255), nullable=False)
    file_type = Column(String(100), nullable=False)
    file_size = Column(Integer, nullable=False)
    stored_name = Column(String(64), nullable=False, unique=True)
    claimed = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
