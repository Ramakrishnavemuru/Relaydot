from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.user import UserPublicResponse


class AttachmentCreate(BaseModel):
    file_url: str
    file_name: str
    file_type: str
    file_size: int
    public_id: Optional[str] = None


class AttachmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    message_id: int
    file_url: str
    file_name: str
    file_type: str
    file_size: int
    public_id: Optional[str] = None
    created_at: str


class ReactionCreate(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=10)


class ReactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    message_id: int
    user_id: int
    emoji: str
    created_at: str
    user: Optional[UserPublicResponse] = None


class MessageCreate(BaseModel):
    conversation_id: int
    content: str = Field(..., max_length=10000)
    message_type: str = "TEXT"  # TEXT, IMAGE, FILE, SYSTEM
    reply_to_id: Optional[int] = None
    attachments: Optional[List[AttachmentCreate]] = None


class MessageEdit(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)


class ReadReceiptCreate(BaseModel):
    message_ids: Optional[List[int]] = None
    conversation_id: Optional[int] = None


class MessageReplyPreview(BaseModel):
    id: int
    sender_id: int
    sender_name: Optional[str] = None
    content: str
    message_type: str


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    sender_id: int
    content: str
    message_type: str
    reply_to_id: Optional[int] = None
    reply_to: Optional[MessageReplyPreview] = None
    created_at: str
    updated_at: Optional[str] = None
    deleted_at: Optional[str] = None
    is_deleted: bool = False
    is_edited: bool = False
    sender: Optional[UserPublicResponse] = None
    attachments: List[AttachmentResponse] = []
    reactions: List[ReactionResponse] = []
    status: str = "SENT"  # SENT, DELIVERED, READ
    read_by: List[int] = []
