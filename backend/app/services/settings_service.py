from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.block import BlockedUser
from app.models.conversation import ConversationMember
from app.models.settings import UserSettings
from app.models.social import Follow


FIELDS = (
    "dm_policy", "group_invite_policy", "story_audience", "notifications_enabled",
    "direct_notifications", "group_notifications", "story_notifications",
    "notification_preview", "notification_sound", "dnd_until", "enter_to_send",
    "chat_text_size", "chat_wallpaper", "auto_download_images",
    "auto_download_videos", "media_quality", "call_ringtone",
    "call_notifications", "accent", "density", "reduced_motion", "high_contrast",
)


def get_settings(db: Session, user_id: int, create: bool = False) -> UserSettings | None:
    row = db.get(UserSettings, user_id)
    if row is None and create:
        row = UserSettings(user_id=user_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def serialize_settings(row: UserSettings) -> dict:
    data = {key: getattr(row, key) for key in FIELDS}
    data["dnd_until"] = row.dnd_until.isoformat() if row.dnd_until else None
    data["updated_at"] = row.updated_at.isoformat() if row.updated_at else None
    return data


def policy_allows(db: Session, target_id: int, actor_id: int, policy_name: str) -> bool:
    if target_id == actor_id:
        return True
    if db.query(BlockedUser.id).filter(
        ((BlockedUser.blocker_id == target_id) & (BlockedUser.blocked_id == actor_id)) |
        ((BlockedUser.blocker_id == actor_id) & (BlockedUser.blocked_id == target_id))
    ).first():
        return False
    row = get_settings(db, target_id)
    policy = getattr(row, policy_name) if row else "EVERYONE"
    if policy == "EVERYONE":
        return True
    if policy == "NOBODY":
        return False
    return db.query(Follow.id).filter_by(follower_id=target_id, following_id=actor_id).first() is not None


def require_policy(db: Session, target_id: int, actor_id: int, policy_name: str, label: str) -> None:
    if not policy_allows(db, target_id, actor_id, policy_name):
        raise HTTPException(403, f"This account does not allow {label} from you")


def alert_allowed(db: Session, recipient_id: int, category: str,
                  conversation_id: int | None = None) -> bool:
    row = get_settings(db, recipient_id)
    if row:
        if not row.notifications_enabled:
            return False
        now = datetime.now(timezone.utc)
        if row.dnd_until and row.dnd_until.replace(tzinfo=timezone.utc) > now:
            return False
        if category == "direct" and not row.direct_notifications:
            return False
        if category == "group" and not row.group_notifications:
            return False
        if category == "story" and not row.story_notifications:
            return False
    if conversation_id:
        member = db.query(ConversationMember).filter_by(
            conversation_id=conversation_id, user_id=recipient_id).first()
        if member and (member.lock_pin_hash or member.is_muted or (member.muted_until and
            member.muted_until.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc))):
            return False
    return True
