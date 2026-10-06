from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict, field_validator
from urllib.parse import urlparse
from app.schemas.user import UserPublicResponse


class AttachmentCreate(BaseModel):
    file_url: str = Field(..., max_length=500)
    file_name: str = Field(..., min_length=1, max_length=255)
    file_type: str = Field(..., max_length=100)
    file_size: int = Field(..., ge=1, le=15 * 1024 * 1024)
    public_id: Optional[str] = None

    @field_validator("file_url")
    @classmethod
    def uploaded_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if value.startswith("/uploads/") and parsed.path == value and ".." not in value:
            return value
        if parsed.scheme == "https" and parsed.hostname == "res.cloudinary.com":
            return value
        raise ValueError("Attachment must use an uploaded file URL")


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
    thread_root_id: Optional[int] = None
    expires_in_seconds: Optional[int] = Field(None, ge=10, le=604800)
    is_forwarded: bool = False
    attachments: Optional[List[AttachmentCreate]] = None


class ScheduledMessageCreate(BaseModel):
    conversation_id: int
    content: str = Field(..., min_length=1, max_length=10000)
    send_at: datetime
    reply_to_id: Optional[int] = None
    thread_root_id: Optional[int] = None


class ForwardMessageCreate(BaseModel):
    conversation_ids: List[int] = Field(..., min_length=1, max_length=10)


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
    thread_root_id: Optional[int] = None
    thread_reply_count: int = 0
    expires_at: Optional[str] = None
    pinned_at: Optional[str] = None
    bookmarked: bool = False
    is_forwarded: bool = False
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
