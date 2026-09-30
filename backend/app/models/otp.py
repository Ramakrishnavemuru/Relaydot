from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, Boolean
from app.database import Base


class OTPVerification(Base):
    __tablename__ = "otp_verifications"

    id = Column(Integer, primary_key=True, index=True)
    identifier = Column(String(120), index=True, nullable=False)  # email or phone number
    otp_code_hash = Column(String(128), nullable=False)
    purpose = Column(String(30), nullable=False)  # REGISTER, LOGIN, VERIFY_PHONE, VERIFY_EMAIL
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    is_used = Column(Boolean, default=False, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
