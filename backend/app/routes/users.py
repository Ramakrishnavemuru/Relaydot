from typing import List
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.schemas.user import (
    UserResponse,
    UserPublicResponse,
    UserProfileUpdate,
    PrivacySettingsUpdate
)
from app.services.user_service import UserService
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/users", tags=["Users"])


@router.get("/me", response_model=UserResponse)
def get_my_profile(current_user: User = Depends(get_current_user)):
    """Get profile of current logged-in user."""
    return current_user.to_dict(include_sensitive=True)


@router.put("/profile", response_model=UserResponse)
def update_my_profile(
    update_data: UserProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update display name, bio, or avatar URL."""
    updated = UserService.update_profile(db, current_user, update_data)
    return updated.to_dict(include_sensitive=True)


@router.put("/privacy", response_model=UserResponse)
def update_my_privacy(
    privacy_data: PrivacySettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update privacy settings (show_last_seen, show_online, show_read_receipts)."""
    updated = UserService.update_privacy(db, current_user, privacy_data)
    return updated.to_dict(include_sensitive=True)


@router.get("/search", response_model=List[UserPublicResponse])
def search_users(
    q: str = Query(..., min_length=1, description="Username or display name search query"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Search users to start new chats with."""
    return UserService.search_users(db, q, current_user.id)


@router.get("/blocked/list", response_model=List[UserPublicResponse])
def get_blocked_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all users blocked by the current user."""
    return UserService.list_blocked_users(db, current_user.id)


@router.get("/{user_id}", response_model=UserPublicResponse)
def get_user_profile(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get public profile of a user by ID."""
    user = UserService.get_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user.to_dict(include_sensitive=False)


@router.post("/{user_id}/block")
def block_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Block a user from contacting you."""
    UserService.block_user(db, current_user.id, user_id)
    return {"message": "User has been blocked"}


@router.delete("/{user_id}/block")
def unblock_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Unblock a user."""
    UserService.unblock_user(db, current_user.id, user_id)
    return {"message": "User has been unblocked"}
