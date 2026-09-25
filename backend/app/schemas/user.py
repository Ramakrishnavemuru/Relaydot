from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr, ConfigDict


class UserProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None


class PrivacySettingsUpdate(BaseModel):
    show_last_seen: Optional[bool] = None
    show_online: Optional[bool] = None
    show_read_receipts: Optional[bool] = None


class UserPublicResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    is_online: bool = False
    last_seen: Optional[str] = None
    created_at: Optional[str] = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: EmailStr
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    is_online: bool = False
    last_seen: Optional[str] = None
    show_last_seen: bool = True
    show_online: bool = True
    show_read_receipts: bool = True
    created_at: Optional[str] = None
