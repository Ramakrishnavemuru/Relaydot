from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict
from app.schemas.user import UserPublicResponse


class StoryCreate(BaseModel):
    media_url: str
    media_type: str = "IMAGE"  # IMAGE, VIDEO, TEXT
    caption: Optional[str] = Field(None, max_length=500)


class StoryReplyRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)


class StoryViewerResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    viewer_id: int
    viewer_name: str
    viewer_username: str
    viewer_avatar: Optional[str] = None
    viewed_at: str


class StoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    media_url: str
    media_type: str
    caption: Optional[str] = None
    created_at: str
    expires_at: str
    views_count: int = 0
    is_viewed: bool = False
    is_own: bool = False
    user: Optional[UserPublicResponse] = None
    views: Optional[List[StoryViewerResponse]] = None


class UserStoriesGroup(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    username: str
    display_name: str
    avatar_url: Optional[str] = None
    all_viewed: bool = False
    stories: List[StoryResponse] = []
