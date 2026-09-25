from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas.conversation import (
    GroupCreate,
    GroupUpdate,
    MemberAdd,
    ConversationResponse,
    ConversationMemberResponse
)
from app.services.conversation_service import ConversationService
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/groups", tags=["Groups"])


@router.post("", response_model=ConversationResponse, status_code=status.HTTP_201_CREATED)
def create_group(
    req: GroupCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new group conversation with members."""
    conv = ConversationService.create_group(db, current_user.id, req)
    convs = ConversationService.list_user_conversations(db, current_user.id)
    for c in convs:
        if c["id"] == conv.id:
            return c
    return {
        "id": conv.id,
        "type": conv.type,
        "name": conv.name,
        "created_at": conv.created_at.isoformat(),
        "members": []
    }


@router.put("/{conversation_id}", response_model=ConversationResponse)
def update_group(
    conversation_id: int,
    req: GroupUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update group name, description, or avatar (Admin only)."""
    conv = ConversationService.update_group(db, conversation_id, current_user.id, req)
    convs = ConversationService.list_user_conversations(db, current_user.id)
    for c in convs:
        if c["id"] == conv.id:
            return c
    return {
        "id": conv.id,
        "type": conv.type,
        "name": conv.name,
        "created_at": conv.created_at.isoformat(),
        "members": []
    }


@router.post("/{conversation_id}/members", status_code=status.HTTP_201_CREATED)
def add_member_to_group(
    conversation_id: int,
    req: MemberAdd,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Add a member to group chat (Admin only)."""
    new_m = ConversationService.add_member(
        db, conversation_id, current_user.id, req.user_id, req.role
    )
    return {"message": "Member added successfully", "member_id": new_m.id}


@router.delete("/{conversation_id}/members/{user_id}")
def remove_member_from_group(
    conversation_id: int,
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Remove a user from group chat (Admin only)."""
    ConversationService.remove_member(db, conversation_id, current_user.id, user_id)
    return {"message": "Member removed successfully"}


@router.post("/{conversation_id}/leave")
def leave_group(
    conversation_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Leave a group conversation."""
    ConversationService.remove_member(db, conversation_id, current_user.id, current_user.id)
    return {"message": "You have left the group"}
