from datetime import datetime, timedelta, timezone
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.config import settings as config
from app.database import get_db
from app.models.conversation import Conversation, ConversationMember
from app.models.message import Message
from app.models.settings import ContactChange, Feedback
from app.models.staff import SupportCase
from app.routes.staff import notify_staff
from app.models.social import Follow, Post, Comment
from app.models.reel import Reel, ReelComment
from app.models.story import Story
from app.models.user import User
from app.schemas.settings import (ContactChangeStart, ContactChangeVerify,
    FeedbackCreate, MuteUpdate, SettingsUpdate, UsernameChange)
from app.security.dependencies import get_current_user
from app.security.jwt import hash_token
from app.security.password import verify_password
from app.services.auth_service import demo_codes_enabled
from app.services.rate_limit import throttle
from app.services.settings_service import FIELDS, get_settings, serialize_settings
from app.utils.helpers import sanitize_text
from app.utils.validators import validate_email, validate_phone_number, validate_username

router = APIRouter(prefix="/settings", tags=["Settings"])


def require_password(user: User, password: str) -> None:
    if not user.password_hash or not verify_password(password, user.password_hash):
        raise HTTPException(403, "Enter your current password to confirm this change")


@router.get("")
def read_settings(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return serialize_settings(get_settings(db, current.id, create=True))


@router.patch("")
def update_settings(data: SettingsUpdate, current: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    row = get_settings(db, current.id, create=True)
    values = data.model_dump(exclude_unset=True)
    if any(value is None for name, value in values.items() if name != "dnd_until"):
        raise HTTPException(400, "Only Do Not Disturb may be cleared")
    if "dnd_until" in values and values["dnd_until"] is not None:
        until = values["dnd_until"].astimezone(timezone.utc)
        if until <= datetime.now(timezone.utc) or until > datetime.now(timezone.utc) + timedelta(days=30):
            raise HTTPException(400, "Choose a Do Not Disturb time within 30 days")
        values["dnd_until"] = until
    for name, value in values.items():
        if name in FIELDS:
            setattr(row, name, value)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return serialize_settings(row)


@router.get("/username-available")
def username_available(username: str = Query(min_length=3, max_length=30),
                       current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    clean = validate_username(username)
    owner = db.query(User.id).filter(User.username == clean).first()
    return {"username": clean, "available": not owner or owner[0] == current.id}


@router.post("/username")
def change_username(data: UsernameChange, current: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    require_password(current, data.current_password)
    clean = validate_username(data.username)
    existing = db.query(User.id).filter(User.username == clean, User.id != current.id).first()
    if existing:
        raise HTTPException(409, "Username is already taken")
    current.username = clean
    current.updated_at = datetime.now(timezone.utc)
    db.commit()
    return current.to_dict(include_sensitive=True)


@router.post("/contact-change")
def start_contact_change(data: ContactChangeStart, current: User = Depends(get_current_user),
                         db: Session = Depends(get_db)):
    require_password(current, data.current_password)
    if not demo_codes_enabled():
        raise HTTPException(503, "Verified contact changes need an email or SMS delivery provider")
    throttle(current.id, "contact_change", 5, 3600)
    value = validate_email(data.value) if data.kind == "email" else validate_phone_number(data.value)
    if db.query(User.id).filter(getattr(User, "email" if data.kind == "email" else "phone_number") == value,
                                User.id != current.id).first():
        raise HTTPException(409, "This contact is already in use")
    db.query(ContactChange).filter_by(user_id=current.id, kind=data.kind).delete()
    code = f"{secrets.randbelow(900000) + 100000}"
    db.add(ContactChange(user_id=current.id, kind=data.kind, new_value=value,
                         code_hash=hash_token(code), expires_at=datetime.now(timezone.utc) + timedelta(minutes=10)))
    db.commit()
    return {"message": "Verify the new contact to finish the change", "demo_code": code}


@router.post("/contact-change/verify")
def verify_contact_change(data: ContactChangeVerify, current: User = Depends(get_current_user),
                          db: Session = Depends(get_db)):
    throttle(current.id, "contact_change_verify", 10, 3600)
    request = db.query(ContactChange).filter_by(user_id=current.id, kind=data.kind).first()
    if not request or request.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc) or \
            request.code_hash != hash_token(data.code):
        raise HTTPException(400, "Invalid or expired verification code")
    column = User.email if data.kind == "email" else User.phone_number
    if db.query(User.id).filter(column == request.new_value, User.id != current.id).first():
        raise HTTPException(409, "This contact is already in use")
    setattr(current, "email" if data.kind == "email" else "phone_number", request.new_value)
    current.updated_at = datetime.now(timezone.utc)
    db.delete(request)
    db.commit()
    return current.to_dict(include_sensitive=True)


@router.get("/conversations")
def conversation_mutes(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(ConversationMember, Conversation).join(
        Conversation, Conversation.id == ConversationMember.conversation_id).filter(
        ConversationMember.user_id == current.id).order_by(Conversation.updated_at.desc()).limit(100).all()
    return [{"id": conv.id, "name": conv.name or f"Direct chat {conv.id}",
             "muted": bool(member.is_muted or (member.muted_until and
                 member.muted_until.replace(tzinfo=timezone.utc) > datetime.now(timezone.utc))),
             "muted_until": member.muted_until.isoformat() if member.muted_until else None}
            for member, conv in rows]


@router.put("/conversations/{conversation_id}/mute")
def mute_conversation(conversation_id: int, data: MuteUpdate,
                      current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    member = db.query(ConversationMember).filter_by(conversation_id=conversation_id,
                                                    user_id=current.id).first()
    if not member:
        raise HTTPException(404, "Conversation not found")
    member.is_muted = data.duration == "forever"
    hours = {"1h": 1, "8h": 8, "24h": 24}.get(data.duration)
    member.muted_until = datetime.now(timezone.utc) + timedelta(hours=hours) if hours else None
    db.commit()
    return {"muted": data.duration != "off", "duration": data.duration,
            "muted_until": member.muted_until.isoformat() if member.muted_until else None}


@router.post("/feedback", status_code=201)
def send_feedback(data: FeedbackCreate, current: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    throttle(current.id, "feedback", 10, 3600)
    message = sanitize_text(data.message.strip())
    item = SupportCase(reporter_id=current.id, kind=data.kind, category="General",
                       title=("Bug report" if data.kind == "BUG" else "Feedback") + f" from @{current.username}",
                       description=message)
    db.add(item)
    db.flush()
    notify_staff(db, "NEW_CASE", "case", item.id, f"New {data.kind.lower()} from @{current.username}")
    db.commit()
    return {"id": item.id, "message": "Feedback saved for the Relaydot team"}


@router.get("/export")
def export_account(current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    own_messages = db.query(Message).filter_by(sender_id=current.id).order_by(Message.id).all()
    own_posts = db.query(Post).filter_by(author_id=current.id).order_by(Post.id).all()
    own_stories = db.query(Story).filter_by(user_id=current.id).order_by(Story.id).all()
    own_comments = db.query(Comment).filter_by(author_id=current.id).order_by(Comment.id).all()
    own_reels = db.query(Reel).filter_by(creator_id=current.id).order_by(Reel.id).all()
    own_reel_comments = db.query(ReelComment).filter_by(author_id=current.id).order_by(ReelComment.id).all()
    membership_ids = [id for (id,) in db.query(ConversationMember.conversation_id).filter_by(user_id=current.id)]
    data = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "account": current.to_dict(include_sensitive=True),
        "settings": serialize_settings(get_settings(db, current.id, create=True)),
        "conversation_ids": membership_ids,
        "messages_sent": [{"id": row.id, "conversation_id": row.conversation_id,
                           "content": row.content if not row.deleted_at else None,
                           "attachments": [{"file_name": file.file_name, "file_url": file.file_url,
                                            "file_type": file.file_type} for file in row.attachments],
                           "created_at": row.created_at.isoformat()} for row in own_messages],
        "posts": [{"id": row.id, "content": row.content, "media_url": row.media_url,
                   "visibility": row.visibility,
                   "created_at": row.created_at.isoformat()} for row in own_posts if not row.deleted_at],
        "comments": [{"id": row.id, "post_id": row.post_id, "content": row.content,
                      "created_at": row.created_at.isoformat()} for row in own_comments if not row.deleted_at],
        "reels": [{"id": row.id, "caption": row.caption, "video_path": row.video_path,
                   "thumbnail_path": row.thumbnail_path,
                   "created_at": row.created_at.isoformat()} for row in own_reels if not row.deleted_at],
        "reel_comments": [{"id": row.id, "reel_id": row.reel_id, "content": row.content,
                           "created_at": row.created_at.isoformat()} for row in own_reel_comments if not row.deleted_at],
        "stories": [{"id": row.id, "caption": row.caption, "media_url": row.media_url,
                     "created_at": row.created_at.isoformat()} for row in own_stories],
        "following_ids": [id for (id,) in db.query(Follow.following_id).filter_by(follower_id=current.id)],
    }
    return JSONResponse(data, headers={"Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="relaydot-account-export.json"'})
