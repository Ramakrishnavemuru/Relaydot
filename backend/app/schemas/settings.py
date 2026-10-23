from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


Audience = Literal["EVERYONE", "FOLLOWING", "NOBODY"]


class SettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    dm_policy: Audience | None = None
    group_invite_policy: Audience | None = None
    story_audience: Audience | None = None
    notifications_enabled: bool | None = None
    direct_notifications: bool | None = None
    group_notifications: bool | None = None
    story_notifications: bool | None = None
    notification_preview: bool | None = None
    notification_sound: bool | None = None
    dnd_until: datetime | None = None
    enter_to_send: bool | None = None
    chat_text_size: Literal["SMALL", "NORMAL", "LARGE"] | None = None
    chat_wallpaper: Literal["DEFAULT", "PLAIN", "DOTS"] | None = None
    auto_download_images: bool | None = None
    auto_download_videos: bool | None = None
    media_quality: Literal["STANDARD", "ORIGINAL"] | None = None
    call_ringtone: bool | None = None
    call_notifications: bool | None = None
    accent: Literal["INDIGO", "TEAL", "CORAL"] | None = None
    density: Literal["COMFORTABLE", "COMPACT"] | None = None
    reduced_motion: bool | None = None
    high_contrast: bool | None = None

    @field_validator("dnd_until")
    @classmethod
    def timezone_required(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.tzinfo is None:
            raise ValueError("Do Not Disturb time must include a time zone")
        return value


class MuteUpdate(BaseModel):
    duration: Literal["1h", "8h", "24h", "forever", "off"]


class FeedbackCreate(BaseModel):
    kind: Literal["BUG", "FEEDBACK"]
    message: str = Field(min_length=10, max_length=2000)


class UsernameChange(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    current_password: str


class ContactChangeStart(BaseModel):
    kind: Literal["email", "phone"]
    value: str
    current_password: str


class ContactChangeVerify(BaseModel):
    kind: Literal["email", "phone"]
    code: str = Field(min_length=6, max_length=6)
