from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class Passkey(Base):
    __tablename__ = "passkeys"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    credential_id = Column(String(255), unique=True, index=True, nullable=False)  # base64url string
    public_key = Column(Text, nullable=False)  # base64url string of public key
    sign_count = Column(Integer, default=0, nullable=False)
    name = Column(String(100), default="Passkey", nullable=False)
    aaguid = Column(String(64), nullable=True)
    transports = Column(String(100), nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    last_used_at = Column(DateTime, nullable=True)

    # Relationship
    user = relationship("User", back_populates="passkeys")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "credential_id": self.credential_id,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "last_used_at": self.last_used_at.isoformat() if self.last_used_at else None
        }
