from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas.message import (
    MessageCreate,
    MessageEdit,
    MessageResponse,
    ReactionCreate,
    ReadReceiptCreate
)
from app.services.message_service import MessageService
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/messages", tags=["Messages"])


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
