from typing import List, Dict, Any
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.story import (
    StoryCreate,
    StoryResponse,
    UserStoriesGroup,
    StoryViewerResponse,
    StoryReplyRequest
)
from app.services.story_service import StoryService
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/stories", tags=["Stories"])


@router.get("", response_model=List[UserStoriesGroup])
def get_active_stories(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Retrieve all active (unexpired, 24-hour) stories grouped by user."""
    return StoryService.get_active_stories(db, current_user.id)


@router.post("", response_model=StoryResponse, status_code=status.HTTP_201_CREATED)
def create_story(
    story_data: StoryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Post a new 24-hour status story."""
    return StoryService.create_story(db, current_user, story_data)


@router.delete("/{story_id}")
def delete_story(
    story_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a story posted by the current user."""
    StoryService.delete_story(db, story_id, current_user.id)
    return {"message": "Story deleted successfully."}


@router.post("/{story_id}/view")
def record_story_view(
    story_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Record that the current user has viewed the story."""
    recorded = StoryService.record_view(db, story_id, current_user.id)
    return {"viewed": True, "newly_recorded": recorded}


@router.get("/{story_id}/views", response_model=List[StoryViewerResponse])
def get_story_views(
    story_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get the list of users who viewed this story (Story author only)."""
    return StoryService.get_story_views(db, story_id, current_user.id)


@router.post("/{story_id}/reply")
async def reply_to_story(
    story_id: int,
    reply_data: StoryReplyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Reply to a story by sending a direct message to the author."""
    msg = await StoryService.reply_to_story(db, story_id, current_user, reply_data.content)
    return {"message": "Reply sent successfully.", "message_data": msg}
