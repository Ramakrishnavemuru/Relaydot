from typing import List, Optional
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query, status, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse
from pathlib import Path
from uuid import uuid4
import mimetypes
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.database import get_db
from app.models.user import User
from app.models.message import Message, MessageBookmark, ScheduledMessage
from app.models.attachment import Attachment
from app.models.chat_upload import ChatUpload
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
from app.services.chat_lock import require_chat_unlocked, is_chat_unlocked
from app.services.settings_service import require_policy
from app.config import settings
from app.utils.validators import validate_file

router = APIRouter(prefix="/messages", tags=["Messages"])
CHAT_MEDIA_DIR = Path(settings.CHAT_MEDIA_DIR).resolve()
try:
    CHAT_MEDIA_DIR.relative_to(Path(settings.UPLOAD_DIR).resolve())
except ValueError:
    pass
else:
    raise RuntimeError("CHAT_MEDIA_DIR must be outside the public UPLOAD_DIR")


@router.get("/conversations/{conversation_id}/security")
def conversation_security(conversation_id: int, request: Request,
                          current: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_chat_unlocked(request, db, current.id, conversation_id)
    from app.services.communication_security import communication_security_status
    return communication_security_status()


@router.post("/uploads", status_code=201)
async def upload_chat_attachment(file: UploadFile = File(...), current_user: User = Depends(get_current_user),
                                 db: Session = Depends(get_db)):
    throttle(current_user.id, "upload", 20)
    name = Path(file.filename or "").name
    if not name or name.lower().endswith(".svg"):
        raise HTTPException(400, "Unsupported chat attachment")
    validate_file(name, 0)
    sample = await file.read(min(settings.MAX_FILE_SIZE_MB, 15) * 1024 * 1024 + 1)
    validate_file(name, len(sample))
    if not sample:
        raise HTTPException(400, "Chat attachment is empty")
    if len(sample) > 15 * 1024 * 1024:
        raise HTTPException(413, "Chat attachment is too large")
    extension = name.rsplit(".", 1)[-1].lower()
    signatures = {"png": sample.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpg": sample.startswith(b"\xff\xd8\xff"), "jpeg": sample.startswith(b"\xff\xd8\xff"),
        "gif": sample.startswith((b"GIF87a", b"GIF89a")),
        "webp": sample.startswith(b"RIFF") and sample[8:12] == b"WEBP",
        "mp4": sample[4:8] == b"ftyp", "pdf": sample.startswith(b"%PDF-")}
    if extension in signatures and not signatures[extension]:
        raise HTTPException(400, "File contents do not match its extension")
    CHAT_MEDIA_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    stored_name = uuid4().hex
    path = CHAT_MEDIA_DIR / stored_name
    try:
        path.write_bytes(sample)
        path.chmod(0o600)
        item = ChatUpload(uploader_id=current_user.id, file_name=name,
                          file_type=mimetypes.guess_type(name)[0] or "application/octet-stream",
                          file_size=len(sample), stored_name=stored_name)
        db.add(item)
        db.commit()
        db.refresh(item)
    except Exception:
        path.unlink(missing_ok=True)
        db.rollback()
        raise
    return {"file_url": f"/api/messages/attachments/{item.id}", "file_name": item.file_name,
            "file_type": item.file_type, "file_size": item.file_size}


@router.get("/attachments/{upload_id}")
def download_chat_attachment(upload_id: str, request: Request,
                             current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.get(ChatUpload, upload_id) if len(upload_id) == 32 else None
    if not item:
        raise HTTPException(404, "Attachment not found")
    if item.claimed:
        allowed = False
        for attachment in db.query(Attachment).filter_by(public_id=upload_id):
            try:
                accessible_message(db, attachment.message_id, current_user.id, request)
                allowed = True
                break
            except HTTPException as exc:
                if exc.status_code == 423:
                    raise
        if not allowed:
            raise HTTPException(404, "Attachment not found")
    elif item.uploader_id != current_user.id:
        raise HTTPException(404, "Attachment not found")
    path = CHAT_MEDIA_DIR / item.stored_name
    if not path.is_file():
        raise HTTPException(404, "Attachment not found")
    return FileResponse(path, media_type=item.file_type, filename=item.file_name,
                        content_disposition_type="inline",
                        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


def accessible_message(db: Session, message_id: int, user_id: int, request: Request | None = None) -> Message:
    message = db.get(Message, message_id)
    if not message or message.deleted_at or (message.expires_at and
        message.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)):
        raise HTTPException(404, "Message not found")
    member = db.query(ConversationMember).filter_by(
        conversation_id=message.conversation_id, user_id=user_id).first()
    if not member or message.id <= (member.cleared_before_message_id or 0):
        raise HTTPException(404, "Message not found")
    if member.lock_pin_hash and (request is None or not is_chat_unlocked(request, member)):
        raise HTTPException(423, "Unlock this chat with its PIN")
    return message


@router.get("/bookmarks", response_model=List[MessageResponse])
def bookmarked_messages(request: Request, limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                        current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(Message).join(MessageBookmark, MessageBookmark.message_id == Message.id)\
        .join(ConversationMember, ConversationMember.conversation_id == Message.conversation_id)\
        .filter(MessageBookmark.user_id == current_user.id, ConversationMember.user_id == current_user.id,
            Message.deleted_at.is_(None), or_(Message.expires_at.is_(None), Message.expires_at > datetime.now(timezone.utc)))\
        .order_by(MessageBookmark.created_at.desc()).offset(offset).limit(limit).all()
    return [MessageService.get_message_response_dict(db, m, current_user.id) for m in rows
            if m.id > next((member.cleared_before_message_id or 0 for member in m.conversation.members
                            if member.user_id == current_user.id), 0)
            and is_chat_unlocked(request, next(member for member in m.conversation.members
                                               if member.user_id == current_user.id))]


@router.get("/scheduled")
def scheduled_messages(request: Request, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.query(ScheduledMessage).filter_by(sender_id=current_user.id, status="PENDING")\
        .order_by(ScheduledMessage.send_at).limit(50).all()
    members = {member.conversation_id: member for member in db.query(ConversationMember).filter_by(
        user_id=current_user.id).all()}
    return [{"id": m.id, "conversation_id": m.conversation_id, "content": m.content,
        "expires_in_seconds": m.expires_in_seconds,
        "send_at": m.send_at.replace(tzinfo=timezone.utc).isoformat() if m.send_at.tzinfo is None else m.send_at.isoformat()} for m in rows
        if m.conversation_id in members and is_chat_unlocked(request, members[m.conversation_id])]


@router.post("/scheduled", status_code=201)
def schedule_message(data: ScheduledMessageCreate, request: Request, current_user: User = Depends(get_current_user),
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
        raise HTTPException(404, "Conversation not found")
    require_chat_unlocked(request, db, current_user.id, data.conversation_id)
    conv = db.get(Conversation, data.conversation_id)
    if conv and conv.type == "DIRECT":
        other = db.query(ConversationMember.user_id).filter(
            ConversationMember.conversation_id == data.conversation_id,
            ConversationMember.user_id != current_user.id).first()
        if other:
            require_policy(db, other[0], current_user.id, "dm_policy", "direct messages")
    if data.reply_to_id:
        if accessible_message(db, data.reply_to_id, current_user.id, request).conversation_id != data.conversation_id:
            raise HTTPException(400, "Reply target is not in this conversation")
    if data.thread_root_id:
        if accessible_message(db, data.thread_root_id, current_user.id, request).conversation_id != data.conversation_id:
            raise HTTPException(400, "Thread target is not in this conversation")
    item = ScheduledMessage(conversation_id=data.conversation_id, sender_id=current_user.id,
        content=data.content.strip(), expires_in_seconds=data.expires_in_seconds, reply_to_id=data.reply_to_id,
        thread_root_id=data.thread_root_id, send_at=when)
    db.add(item); db.commit(); db.refresh(item)
    return {"id": item.id, "conversation_id": item.conversation_id,
        "content": item.content, "expires_in_seconds": item.expires_in_seconds,
        "send_at": item.send_at.replace(tzinfo=timezone.utc).isoformat() if item.send_at.tzinfo is None else item.send_at.isoformat(), "status": item.status}


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
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Send a new message to a conversation."""
    require_chat_unlocked(request, db, current_user.id, msg_data.conversation_id)
    return await MessageService.send_message(db, current_user.id, msg_data)


@router.get("/conversation/{conversation_id}", response_model=List[MessageResponse])
def get_conversation_messages(
    conversation_id: int,
    request: Request,
    limit: int = Query(50, ge=1, le=100),
    before_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Fetch paginated message history for a conversation."""
    require_chat_unlocked(request, db, current_user.id, conversation_id)
    return MessageService.get_messages(db, conversation_id, current_user.id, limit=limit, before_id=before_id)


@router.put("/{message_id}", response_model=MessageResponse)
async def edit_message(
    message_id: int,
    edit_data: MessageEdit,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Edit a previously sent message."""
    accessible_message(db, message_id, current_user.id, request)
    return await MessageService.edit_message(db, current_user.id, message_id, edit_data)


@router.delete("/{message_id}", response_model=MessageResponse)
async def delete_message(
    message_id: int,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a message (soft delete)."""
    accessible_message(db, message_id, current_user.id, request)
    return await MessageService.delete_message(db, current_user.id, message_id)


@router.post("/{message_id}/reaction", response_model=MessageResponse)
async def toggle_reaction(
    message_id: int,
    rxn: ReactionCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add or toggle an emoji reaction on a message."""
    accessible_message(db, message_id, current_user.id, request)
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
def message_thread(message_id: int, request: Request, limit: int = Query(30, ge=1, le=50),
                   offset: int = Query(0, ge=0), current_user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    root = accessible_message(db, message_id, current_user.id, request)
    root_id = root.thread_root_id or root.id
    rows = db.query(Message).filter(Message.thread_root_id == root_id, Message.deleted_at.is_(None),
        or_(Message.expires_at.is_(None), Message.expires_at > datetime.now(timezone.utc)))\
        .order_by(Message.created_at, Message.id).offset(offset).limit(limit).all()
    return [MessageService.get_message_response_dict(db, m, current_user.id) for m in rows]


@router.get("/{message_id}", response_model=MessageResponse)
def get_message(message_id: int, request: Request, current_user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    return MessageService.get_message_response_dict(db,
        accessible_message(db, message_id, current_user.id, request), current_user.id)


@router.post("/{message_id}/forward", response_model=List[MessageResponse])
async def forward_message(message_id: int, data: ForwardMessageCreate, request: Request,
                          current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    throttle(current_user.id, "forward", 30)
    source = accessible_message(db, message_id, current_user.id, request)
    destinations = list(dict.fromkeys(data.conversation_ids))
    if len(destinations) != len(data.conversation_ids):
        raise HTTPException(400, "Choose each destination once")
    for conv_id in destinations:
        conv = db.get(Conversation, conv_id)
        if not conv or not db.query(ConversationMember.id).filter_by(
            conversation_id=conv_id, user_id=current_user.id).first():
            raise HTTPException(404, "Conversation not found")
        if conv.type == "DIRECT":
            other = db.query(ConversationMember.user_id).filter(
                ConversationMember.conversation_id == conv_id,
                ConversationMember.user_id != current_user.id).first()
            if other and UserService.is_blocked(db, current_user.id, other[0]):
                raise HTTPException(403, "Cannot forward to a blocked conversation")
    from app.schemas.message import AttachmentCreate
    attachments = [AttachmentCreate.model_construct(file_url=a.file_url, file_name=a.file_name,
        file_type=a.file_type, file_size=a.file_size, public_id=a.public_id) for a in source.attachments]
    result = []
    for conv_id in destinations:
        result.append(await MessageService.send_message(db, current_user.id,
            MessageCreate(conversation_id=conv_id, content=source.content,
                message_type=source.message_type, attachments=attachments, is_forwarded=True),
            trusted_forward=True))
    return result


@router.post("/{message_id}/bookmark", response_model=MessageResponse)
def bookmark_message(message_id: int, request: Request, current_user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    message = accessible_message(db, message_id, current_user.id, request)
    if not db.query(MessageBookmark.id).filter_by(message_id=message_id, user_id=current_user.id).first():
        db.add(MessageBookmark(message_id=message_id, user_id=current_user.id)); db.commit()
    return MessageService.get_message_response_dict(db, message, current_user.id)


@router.delete("/{message_id}/bookmark", response_model=MessageResponse)
def unbookmark_message(message_id: int, request: Request, current_user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    message = accessible_message(db, message_id, current_user.id, request)
    db.query(MessageBookmark).filter_by(message_id=message_id, user_id=current_user.id).delete(); db.commit()
    return MessageService.get_message_response_dict(db, message, current_user.id)


@router.post("/{message_id}/pin", response_model=MessageResponse)
async def pin_message(message_id: int, request: Request, current_user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    message = accessible_message(db, message_id, current_user.id, request)
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
async def unpin_message(message_id: int, request: Request, current_user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    message = accessible_message(db, message_id, current_user.id, request)
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
