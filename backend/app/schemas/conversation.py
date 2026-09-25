from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.user import UserPublicResponse


class DirectConversationCreate(BaseModel):
    recipient_id: int


class GroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    member_ids: List[int] = Field(default_factory=list)
    avatar_url: Optional[str] = None
    description: Optional[str] = None


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    avatar_url: Optional[str] = None
    description: Optional[str] = None


class MemberAdd(BaseModel):
    user_id: int
    role: str = "MEMBER"  # ADMIN or MEMBER


class MemberUpdateRole(BaseModel):
    role: str  # ADMIN or MEMBER


class ConversationMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    user_id: int
    role: str
    joined_at: str
    is_muted: bool = False
    user: Optional[UserPublicResponse] = None


class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str  # DIRECT or GROUP
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    description: Optional[str] = None
    created_by_id: Optional[int] = None
    created_at: str
    updated_at: Optional[str] = None
    members: List[ConversationMemberResponse] = []
    unread_count: int = 0
    last_message: Optional[dict] = None
    other_user: Optional[UserPublicResponse] = None  # Populated for DIRECT conversations
