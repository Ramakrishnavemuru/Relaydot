from typing import List, Optional
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query, status, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.database import get_db
from app.models.user import User
from app.models.message import Message, MessageBookmark, ScheduledMessage
from app.models.conversation import Conversation, ConversationMember
from app.schemas.message import (
    MessageCreate,
    MessageEdit,
    MessageResponse,
    ReactionCreate,
    ReadReceiptCreate, ScheduledMessageCreate, ForwardMessageCreate
)
from app.services.message_service import MessageService
from app.security.dependencies import get_current_user
from app.services.user_service import UserService
from app.services.rate_limit import throttle

router = APIRouter(prefix="/messages", tags=["Messages"])


def accessible_message(db: Session, message_id: int, user_id: int) -> Message:
    message = db.get(Message, message_id)
    if not message or message.deleted_at or (message.expires_at and
        message.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)):
        raise HTTPException(404, "Message not found")
    if not db.query(ConversationMember.id).filter_by(
        conversation_id=message.conversation_id, user_id=user_id).first():
        raise HTTPException(404, "Message not found")
    return message


@router.get("/bookmarks", response_model=List[MessageResponse])
def bookmarked_messages(limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                        current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Message).join(MessageBookmark, MessageBookmark.message_id == Message.id)\
        .join(ConversationMember, ConversationMember.conversation_id == Message.conversation_id)\
        .filter(MessageBookmark.user_id == current_user.id, ConversationMember.user_id == current_user.id,
            Message.deleted_at.is_(None), or_(Message.expires_at.is_(None), Message.expires_at > datetime.now(timezone.utc)))\
        .order_by(MessageBookmark.created_at.desc()).offset(offset).limit(limit).all()
    return [MessageService.get_message_response_dict(db, m, current_user.id) for m in rows]


@router.get("/scheduled")
def scheduled_messages(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(ScheduledMessage).filter_by(sender_id=current_user.id, status="PENDING")\
        .order_by(ScheduledMessage.send_at).limit(50).all()
    return [{"id": m.id, "conversation_id": m.conversation_id, "content": m.content,
        "send_at": m.send_at.replace(tzinfo=timezone.utc).isoformat() if m.send_at.tzinfo is None else m.send_at.isoformat()} for m in rows]


@router.post("/scheduled", status_code=201)
def schedule_message(data: ScheduledMessageCreate, current_user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    throttle(current_user.id, "schedule", 20)
    when = data.send_at
    if when.tzinfo is None:
        raise HTTPException(400, "Schedule time must include a time zone")
    when = when.astimezone(timezone.utc)
    if not datetime.now(timezone.utc) + timedelta(seconds=5) < when <= datetime.now(timezone.utc) + timedelta(days=365):
        raise HTTPException(400, "Schedule time must be 5 seconds to one year from now")
    if not db.query(ConversationMember.id).filter_by(conversation_id=data.conversation_id,
        user_id=current_user.id).first():
        raise HTTPException(403, "Not a conversation member")
    if data.reply_to_id:
        if accessible_message(db, data.reply_to_id, current_user.id).conversation_id != data.conversation_id:
            raise HTTPException(400, "Reply target is not in this conversation")
    if data.thread_root_id:
        if accessible_message(db, data.thread_root_id, current_user.id).conversation_id != data.conversation_id:
            raise HTTPException(400, "Thread target is not in this conversation")
    item = ScheduledMessage(conversation_id=data.conversation_id, sender_id=current_user.id,
        content=data.content.strip(), reply_to_id=data.reply_to_id,
        thread_root_id=data.thread_root_id, send_at=when)
    db.add(item); db.commit(); db.refresh(item)
    return {"id": item.id, "conversation_id": item.conversation_id,
        "content": item.content, "send_at": item.send_at.replace(tzinfo=timezone.utc).isoformat() if item.send_at.tzinfo is None else item.send_at.isoformat(), "status": item.status}


@router.delete("/scheduled/{scheduled_id}")
def cancel_scheduled_message(scheduled_id: int, current_user: User = Depends(get_current_user),
                             db: Session = Depends(get_db)):
    item = db.query(ScheduledMessage).filter_by(id=scheduled_id, sender_id=current_user.id).first()
    if not item:
        raise HTTPException(404, "Scheduled message not found")
    if item.status != "PENDING":
        raise HTTPException(409, "Message is already being sent")
    item.status = "CANCELLED"; db.commit()
    return {"cancelled": True}


@router.post("", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def send_message(
    msg_data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a new message to a conversation."""
    return await MessageService.send_message(db, current_user.id, msg_data)


@router.get("/conversation/{conversation_id}", response_model=List[MessageResponse])
def get_conversation_messages(
    conversation_id: int,
    limit: int = Query(50, ge=1, le=100),
    before_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fetch paginated message history for a conversation."""
    return MessageService.get_messages(db, conversation_id, current_user.id, limit=limit, before_id=before_id)


@router.put("/{message_id}", response_model=MessageResponse)
async def edit_message(
    message_id: int,
    edit_data: MessageEdit,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Edit a previously sent message."""
    return await MessageService.edit_message(db, current_user.id, message_id, edit_data)


@router.delete("/{message_id}", response_model=MessageResponse)
async def delete_message(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a message (soft delete)."""
    return await MessageService.delete_message(db, current_user.id, message_id)


@router.post("/{message_id}/reaction", response_model=MessageResponse)
async def toggle_reaction(
    message_id: int,
    rxn: ReactionCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add or toggle an emoji reaction on a message."""
    return await MessageService.toggle_reaction(db, current_user.id, message_id, rxn.emoji)


@router.post("/read")
async def mark_messages_as_read(
    req: ReadReceiptCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Mark unread messages in a conversation as read."""
    if req.conversation_id:
        count = await MessageService.mark_as_read(db, current_user.id, req.conversation_id)
        return {"message": "Messages marked as read", "count": count}
    return {"message": "No conversation specified"}


@router.get("/{message_id}/thread", response_model=List[MessageResponse])
def message_thread(message_id: int, limit: int = Query(30, ge=1, le=50),
                   offset: int = Query(0, ge=0), current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    root = accessible_message(db, message_id, current_user.id)
    root_id = root.thread_root_id or root.id
    rows = db.query(Message).filter(Message.thread_root_id == root_id, Message.deleted_at.is_(None),
        or_(Message.expires_at.is_(None), Message.expires_at > datetime.now(timezone.utc)))\
        .order_by(Message.created_at, Message.id).offset(offset).limit(limit).all()
    return [MessageService.get_message_response_dict(db, m, current_user.id) for m in rows]


@router.get("/{message_id}", response_model=MessageResponse)
def get_message(message_id: int, current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    return MessageService.get_message_response_dict(db,
        accessible_message(db, message_id, current_user.id), current_user.id)


@router.post("/{message_id}/forward", response_model=List[MessageResponse])
async def forward_message(message_id: int, data: ForwardMessageCreate,
                          current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current_user.id, "forward", 30)
    source = accessible_message(db, message_id, current_user.id)
    destinations = list(dict.fromkeys(data.conversation_ids))
    if len(destinations) != len(data.conversation_ids):
        raise HTTPException(400, "Choose each destination once")
    for conv_id in destinations:
        conv = db.get(Conversation, conv_id)
        if not conv or not db.query(ConversationMember.id).filter_by(
            conversation_id=conv_id, user_id=current_user.id).first():
            raise HTTPException(403, "Not a destination member")
        if conv.type == "DIRECT":
            other = db.query(ConversationMember.user_id).filter(
                ConversationMember.conversation_id == conv_id,
                ConversationMember.user_id != current_user.id).first()
            if other and UserService.is_blocked(db, current_user.id, other[0]):
                raise HTTPException(403, "Cannot forward to a blocked conversation")
    from app.schemas.message import AttachmentCreate
    attachments = [AttachmentCreate(file_url=a.file_url, file_name=a.file_name,
        file_type=a.file_type, file_size=a.file_size, public_id=a.public_id) for a in source.attachments]
    result = []
    for conv_id in destinations:
        result.append(await MessageService.send_message(db, current_user.id,
            MessageCreate(conversation_id=conv_id, content=source.content,
                message_type=source.message_type, attachments=attachments, is_forwarded=True)))
    return result


@router.post("/{message_id}/bookmark", response_model=MessageResponse)
def bookmark_message(message_id: int, current_user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    message = accessible_message(db, message_id, current_user.id)
    if not db.query(MessageBookmark.id).filter_by(message_id=message_id, user_id=current_user.id).first():
        db.add(MessageBookmark(message_id=message_id, user_id=current_user.id)); db.commit()
    return MessageService.get_message_response_dict(db, message, current_user.id)


@router.delete("/{message_id}/bookmark", response_model=MessageResponse)
def unbookmark_message(message_id: int, current_user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    message = accessible_message(db, message_id, current_user.id)
    db.query(MessageBookmark).filter_by(message_id=message_id, user_id=current_user.id).delete(); db.commit()
    return MessageService.get_message_response_dict(db, message, current_user.id)


@router.post("/{message_id}/pin", response_model=MessageResponse)
async def pin_message(message_id: int, current_user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    message = accessible_message(db, message_id, current_user.id)
    conv = db.get(Conversation, message.conversation_id)
    membership = db.query(ConversationMember).filter_by(conversation_id=conv.id,
        user_id=current_user.id).first()
    if conv.type == "GROUP" and membership.role != "ADMIN":
        raise HTTPException(403, "Only group admins can pin messages")
    message.pinned_at = datetime.now(timezone.utc); message.pinned_by_id = current_user.id
    db.commit()
    from app.websocket.manager import manager
    await manager.broadcast_to_conversation(conv.id, {"event":"message.pinned", "data":{
        "conversation_id":conv.id, "message_id":message.id, "pinned":True}}, db=db)
    return MessageService.get_message_response_dict(db, message, current_user.id)


@router.delete("/{message_id}/pin", response_model=MessageResponse)
async def unpin_message(message_id: int, current_user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    message = accessible_message(db, message_id, current_user.id)
    conv = db.get(Conversation, message.conversation_id)
    membership = db.query(ConversationMember).filter_by(conversation_id=conv.id,
        user_id=current_user.id).first()
    if conv.type == "GROUP" and membership.role != "ADMIN":
        raise HTTPException(403, "Only group admins can unpin messages")
    message.pinned_at = None; message.pinned_by_id = None
    db.commit()
    from app.websocket.manager import manager
    await manager.broadcast_to_conversation(conv.id, {"event":"message.pinned", "data":{
        "conversation_id":conv.id, "message_id":message.id, "pinned":False}}, db=db)
    return MessageService.get_message_response_dict(db, message, current_user.id)
