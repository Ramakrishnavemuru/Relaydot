from typing import Literal
from pydantic import BaseModel, Field, field_validator


Visibility = Literal["EVERYONE", "FOLLOWERS", "FRIENDS", "ONLY_ME"]
ReplyPolicy = Literal["EVERYONE", "FOLLOWERS", "FOLLOWING", "NOBODY"]


class PostCreate(BaseModel):
    content: str = Field(default="", max_length=5000)
    media_url: str | None = Field(default=None, max_length=500)
    media_type: Literal["IMAGE", "VIDEO", "GIF"] | None = None
    visibility: Visibility = "EVERYONE"
    reply_policy: ReplyPolicy = "EVERYONE"
    community_id: int | None = None
    quote_of_id: int | None = None
    thread_parent_id: int | None = None
    poll_options: list[str] | None = None

    @field_validator("poll_options")
    @classmethod
    def valid_poll(cls, value):
        if value is not None:
            if not 2 <= len(value) <= 6 or any(not 1 <= len(x.strip()) <= 100 for x in value):
                raise ValueError("Polls need 2–6 options of 1–100 characters")
            if len({x.strip().casefold() for x in value}) != len(value):
                raise ValueError("Poll options must be unique")
        return value


class PostEdit(BaseModel):
    content: str = Field(..., max_length=5000)
    visibility: Visibility | None = None
    reply_policy: ReplyPolicy | None = None


class CommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)
    parent_id: int | None = None


class ReactionCreate(BaseModel):
    emoji: Literal["❤️", "👍", "😂", "🔥", "🎉"] = "❤️"


class VoteCreate(BaseModel):
    option_id: int


class CommunityCreate(BaseModel):
    name: str = Field(..., min_length=3, max_length=100)
    description: str = Field(default="", max_length=2000)
    avatar_url: str | None = Field(default=None, max_length=500)
    banner_url: str | None = Field(default=None, max_length=500)


class CommunityEdit(CommunityCreate):
    pass


class MemberRole(BaseModel):
    role: Literal["MEMBER", "MODERATOR"]


class ReportCreate(BaseModel):
    entity_type: Literal["post", "comment", "user", "community", "message"]
    entity_id: int
    reason: Literal["spam", "harassment", "impersonation", "inappropriate", "scam", "other"]
    details: str | None = Field(default=None, max_length=500)


class ShareCreate(BaseModel):
    conversation_id: int


class NotificationRead(BaseModel):
    ids: list[int] | None = None
