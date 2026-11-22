from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from app.database import Base


class SecurityEvent(Base):
    __tablename__ = "security_events"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = Column(String(40), nullable=False)
    description = Column(String(240), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)


def record_security_event(db, user_id, kind, description):
    db.add(SecurityEvent(user_id=user_id, kind=kind, description=description))

    # Security alerts use the existing in-app notification inbox. No secrets or IPs.
    from app.models.social import SocialNotification
    from app.models.session import UserSession
    labels = {"MFA_ENABLED": "security_mfa_enabled", "MFA_DISABLED": "security_mfa_disabled",
              "PASSWORD_CHANGED": "security_password", "RECOVERY_CODES": "security_recovery",
              "NEW_CONTEXT": "security_login"}
    if kind in labels and (kind != "NEW_CONTEXT" or db.query(UserSession.id).filter_by(user_id=user_id).first()):
        db.add(SocialNotification(recipient_id=user_id, actor_id=user_id, type=labels[kind],
                                  entity_type="security", entity_id=user_id))
