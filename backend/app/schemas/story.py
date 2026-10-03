from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, ConfigDict, model_validator
from app.schemas.user import UserPublicResponse


class StoryCreate(BaseModel):
    media_url: str
    media_type: Literal["IMAGE", "VIDEO", "TEXT"] = "IMAGE"
    caption: Optional[str] = Field(None, max_length=500)
    visibility: Literal["EVERYONE", "FOLLOWERS", "FRIENDS", "ONLY_ME"] = "EVERYONE"

    @model_validator(mode="after")
    def valid_media(self):
        from urllib.parse import urlparse
        if self.media_type == "TEXT":
            if not self.caption or not self.caption.strip():
                raise ValueError("Text stories need content")
            self.media_url = ""
            return self
        parsed = urlparse(self.media_url)
        extensions = {"IMAGE": ("jpg", "jpeg", "png", "webp", "gif"), "VIDEO": ("mp4",)}
        extension = parsed.path.rsplit(".", 1)[-1].lower()
        if extension not in extensions[self.media_type] or not (
                self.media_url.startswith("/uploads/") or
                (parsed.scheme == "https" and parsed.hostname == "res.cloudinary.com")):
            raise ValueError("Choose an uploaded image or video")
        return self


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
    visibility: str = "EVERYONE"
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
