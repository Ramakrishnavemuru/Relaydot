from typing import List
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas.conversation import (
    DirectConversationCreate,
    ConversationResponse
)
from app.services.conversation_service import ConversationService
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/conversations", tags=["Conversations"])


@router.get("", response_model=List[ConversationResponse])
def get_user_conversations(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all direct and group conversations for the authenticated user."""
    return ConversationService.list_user_conversations(db, current_user.id)


@router.post("/direct", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
def start_direct_conversation(
    req: DirectConversationCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Start or retrieve an existing direct conversation with another user."""
    conv = ConversationService.get_or_create_direct_conversation(db, current_user.id, req.recipient_id)
    # Return formatted list response for this single conversation
    convs = ConversationService.list_user_conversations(db, current_user.id)
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
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get single conversation metadata and member list."""
    ConversationService.get_conversation_or_404(db, conversation_id, current_user.id)
    convs = ConversationService.list_user_conversations(db, current_user.id)
    for c in convs:
        if c["id"] == conversation_id:
            return c
    raise HTTPException(status_code=404, detail="Conversation not found")
