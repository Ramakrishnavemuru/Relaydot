from typing import List
import secrets
from fastapi import APIRouter, Depends, status, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.database import get_db
from app.models.user import User
from app.models.conversation import ConversationMember
from app.models.message import Message
from app.schemas.conversation import (
    DirectConversationCreate,
    ConversationResponse
)
from app.services.conversation_service import ConversationService
from app.security.dependencies import get_current_user
from app.services.chat_lock import hash_chat_pin, verify_chat_pin, is_chat_unlocked, lock_cookie_name, unlock_token
from app.services.rate_limit import throttle

router = APIRouter(prefix="/conversations", tags=["Conversations"])


class ConversationPreferences(BaseModel):
    is_pinned: bool | None = None
    is_archived: bool | None = None
    is_favourite: bool | None = None
    mute_messages: bool | None = None
    mute_calls: bool | None = None


class ChatPin(BaseModel):
    pin: str = Field(pattern=r"^[0-9]{4}$")


def own_membership(db: Session, conversation_id: int, user_id: int) -> ConversationMember:
    member = db.query(ConversationMember).filter_by(conversation_id=conversation_id, user_id=user_id).first()
    if not member:
        raise HTTPException(404, "Conversation not found")
    return member


def clear_for_member(db: Session, member: ConversationMember) -> None:
    latest = db.query(func.max(Message.id)).filter_by(conversation_id=member.conversation_id).scalar() or 0
    member.cleared_before_message_id = max(member.cleared_before_message_id or 0, latest)


@router.patch("/{conversation_id}/preferences")
def update_preferences(conversation_id: int, changes: ConversationPreferences,
                       current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    member = own_membership(db, conversation_id, current_user.id)
    for key, value in changes.model_dump(exclude_none=True).items():
        if key == "mute_messages":
            member.is_muted = value
            member.muted_until = None
        else:
            setattr(member, key, value)
    db.commit()
    return {"updated": True}


@router.post("/{conversation_id}/clear")
def clear_conversation(conversation_id: int, current_user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    member = own_membership(db, conversation_id, current_user.id)
    clear_for_member(db, member)
    db.commit()
    return {"cleared": True}


@router.delete("/{conversation_id}")
def delete_conversation_for_me(conversation_id: int, current_user: User = Depends(get_current_user),
                               db: Session = Depends(get_db)):
    member = own_membership(db, conversation_id, current_user.id)
    clear_for_member(db, member)
    member.is_hidden = True
    db.commit()
    return {"deleted_for_me": True}


@router.post("/{conversation_id}/lock")
def lock_conversation(conversation_id: int, data: ChatPin, request: Request, response: Response,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    member = own_membership(db, conversation_id, current_user.id)
    if member.lock_pin_hash:
        raise HTTPException(409, "This chat is already locked")
    member.lock_pin_hash = hash_chat_pin(data.pin)
    member.lock_version = secrets.token_hex(16)
    db.commit()
    response.delete_cookie(lock_cookie_name(conversation_id), path="/api")
    response.delete_cookie(lock_cookie_name(conversation_id), path="/")
    return {"is_locked": True, "is_unlocked": False}


@router.post("/{conversation_id}/unlock")
def unlock_conversation(conversation_id: int, data: ChatPin, request: Request, response: Response,
                        current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    member = own_membership(db, conversation_id, current_user.id)
    if not member.lock_pin_hash:
        raise HTTPException(409, "This chat is not locked")
    throttle(current_user.id, f"chat_pin_{conversation_id}", 5, 300)
    if not verify_chat_pin(data.pin, member.lock_pin_hash):
        raise HTTPException(403, "Incorrect chat PIN")
    response.delete_cookie(lock_cookie_name(conversation_id), path="/api")
    response.set_cookie(lock_cookie_name(conversation_id), unlock_token(member, request.state.session_id),
                        max_age=900, httponly=True, secure=request.url.scheme == "https",
                        samesite="lax", path="/")
    return {"is_locked": True, "is_unlocked": True}


@router.post("/{conversation_id}/relock")
def relock_conversation(conversation_id: int, response: Response,
                        current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    own_membership(db, conversation_id, current_user.id)
    response.delete_cookie(lock_cookie_name(conversation_id), path="/api")
    response.delete_cookie(lock_cookie_name(conversation_id), path="/")
    return {"is_unlocked": False}


@router.delete("/{conversation_id}/lock")
def remove_chat_lock(conversation_id: int, data: ChatPin, request: Request, response: Response,
                     current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    member = own_membership(db, conversation_id, current_user.id)
    throttle(current_user.id, f"chat_pin_{conversation_id}", 5, 300)
    if not member.lock_pin_hash or not verify_chat_pin(data.pin, member.lock_pin_hash):
        raise HTTPException(403, "Incorrect chat PIN")
    member.lock_pin_hash = None
    member.lock_version = None
    db.commit()
    response.delete_cookie(lock_cookie_name(conversation_id), path="/api")
    response.delete_cookie(lock_cookie_name(conversation_id), path="/")
    return {"is_locked": False}


@router.get("", response_model=List[ConversationResponse])
def get_user_conversations(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all direct and group conversations for the authenticated user."""
    return ConversationService.list_user_conversations(db, current_user.id, request)


@router.post("/direct", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
def start_direct_conversation(
    req: DirectConversationCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Start or retrieve an existing direct conversation with another user."""
    conv = ConversationService.get_or_create_direct_conversation(db, current_user.id, req.recipient_id)
    member = own_membership(db, conv.id, current_user.id)
    if member.is_hidden:
        member.is_hidden = False
        db.commit()
    # Return formatted list response for this single conversation
    convs = ConversationService.list_user_conversations(db, current_user.id, request)
    for c in convs:
        if c["id"] == conv.id:
            return c
    return {
        "id": conv.id,
        "type": conv.type,
        "created_at": conv.created_at.isoformat(),
        "members": []
    }


@router.get("/{conversation_id}", response_model=ConversationResponse)
def get_conversation_details(
    conversation_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get single conversation metadata and member list."""
    ConversationService.get_conversation_or_404(db, conversation_id, current_user.id)
    convs = ConversationService.list_user_conversations(db, current_user.id, request)
    for c in convs:
        if c["id"] == conversation_id:
            return c
    raise HTTPException(status_code=404, detail="Conversation not found")
