"""Small, privacy-aware event recorder for creator metrics."""
from datetime import datetime, timezone
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.creator import CreatorEvent
from app.models.social import Follow
from app.models.user import User


def audience_kind(db: Session, owner_id: int, actor_id: int) -> str:
    if owner_id == actor_id:
        return "OWNER"
    exists = db.query(Follow.id).filter_by(follower_id=actor_id, following_id=owner_id).first()
    return "FOLLOWER" if exists else "NON_FOLLOWER"


def record(db: Session, owner_id: int, actor_id: int | None, event_type: str,
           content_type: str | None = None, content_id: int | None = None,
           *, dedupe_key: str | None = None, commit: bool = True) -> bool:
    owner = db.get(User, owner_id)
    if not owner or owner.is_private:
        return False
    if actor_id == owner_id and event_type in {"POST_VIEW", "PROFILE_VISIT"}:
        return False
    now = datetime.now(timezone.utc)
    if dedupe_key and db.query(CreatorEvent.id).filter_by(dedupe_key=dedupe_key).first():
        return False
    db.add(CreatorEvent(owner_id=owner_id, actor_id=actor_id,
                        event_type=event_type, content_type=content_type,
                        content_id=content_id, day=now.date(), created_at=now,
                        audience_kind=audience_kind(db, owner_id, actor_id) if actor_id else "UNKNOWN",
                        dedupe_key=dedupe_key))
    if commit:
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            return False
    return True


def record_daily_view(db: Session, owner_id: int, actor_id: int,
                      content_type: str, content_id: int) -> bool:
    day = datetime.now(timezone.utc).date().isoformat()
    key = f"{content_type}:{content_id}:{actor_id}:{day}"
    return record(db, owner_id, actor_id, f"{content_type}_VIEW",
                  content_type, content_id, dedupe_key=key)


def record_profile_visit(db: Session, owner_id: int, actor_id: int) -> bool:
    day = datetime.now(timezone.utc).date().isoformat()
    return record(db, owner_id, actor_id, "PROFILE_VISIT",
                  dedupe_key=f"profile:{owner_id}:{actor_id}:{day}")
