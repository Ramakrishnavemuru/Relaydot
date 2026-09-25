from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_

from app.models.user import User
from app.models.block import BlockedUser
from app.schemas.user import UserProfileUpdate, PrivacySettingsUpdate
from app.utils.helpers import sanitize_text


class UserService:
    @staticmethod
    def get_by_id(db: Session, user_id: int) -> Optional[User]:
        return db.query(User).filter(User.id == user_id).first()

    @staticmethod
    def get_by_username(db: Session, username: str) -> Optional[User]:
        return db.query(User).filter(User.username == username.lower()).first()

    @staticmethod
    def update_profile(db: Session, user: User, update_data: UserProfileUpdate) -> User:
        if update_data.display_name is not None:
            user.display_name = sanitize_text(update_data.display_name)
        if update_data.bio is not None:
            user.bio = sanitize_text(update_data.bio)
        if update_data.avatar_url is not None:
            user.avatar_url = update_data.avatar_url.strip()

        user.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(user)
        return user

    @staticmethod
    def update_privacy(db: Session, user: User, settings_data: PrivacySettingsUpdate) -> User:
        if settings_data.show_last_seen is not None:
            user.show_last_seen = settings_data.show_last_seen
        if settings_data.show_online is not None:
            user.show_online = settings_data.show_online
        if settings_data.show_read_receipts is not None:
            user.show_read_receipts = settings_data.show_read_receipts

        user.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(user)
        return user

    @staticmethod
    def search_users(db: Session, query: str, current_user_id: int) -> List[Dict[str, Any]]:
        clean_q = query.strip().lower()
        if not clean_q:
            return []

        # Find users blocked by current_user or who blocked current_user
        blocked_pairs = (
            db.query(BlockedUser)
            .filter(
                or_(
                    BlockedUser.blocker_id == current_user_id,
                    BlockedUser.blocked_id == current_user_id
                )
            )
            .all()
        )
        excluded_ids = {current_user_id}
        for b in blocked_pairs:
            excluded_ids.add(b.blocker_id)
            excluded_ids.add(b.blocked_id)

        users = (
            db.query(User)
            .filter(
                and_(
                    ~User.id.in_(excluded_ids),
                    or_(
                        User.username.ilike(f"%{clean_q}%"),
                        User.display_name.ilike(f"%{clean_q}%"),
                        User.email.ilike(f"%{clean_q}%")
                    )
                )
            )
            .limit(20)
            .all()
        )

        return [u.to_dict(include_sensitive=False) for u in users]

    @staticmethod
    def block_user(db: Session, blocker_id: int, blocked_id: int) -> None:
        if blocker_id == blocked_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot block yourself."
            )

        target = db.query(User).filter(User.id == blocked_id).first()
        if not target:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User to block not found."
            )

        existing = db.query(BlockedUser).filter(
            BlockedUser.blocker_id == blocker_id,
            BlockedUser.blocked_id == blocked_id
        ).first()

        if not existing:
            block_record = BlockedUser(blocker_id=blocker_id, blocked_id=blocked_id)
            db.add(block_record)
            db.commit()

    @staticmethod
    def unblock_user(db: Session, blocker_id: int, blocked_id: int) -> None:
        existing = db.query(BlockedUser).filter(
            BlockedUser.blocker_id == blocker_id,
            BlockedUser.blocked_id == blocked_id
        ).first()

        if existing:
            db.delete(existing)
            db.commit()

    @staticmethod
    def is_blocked(db: Session, user_a_id: int, user_b_id: int) -> bool:
        """Returns True if user_a has blocked user_b or user_b has blocked user_a."""
        return db.query(BlockedUser).filter(
            or_(
                and_(BlockedUser.blocker_id == user_a_id, BlockedUser.blocked_id == user_b_id),
                and_(BlockedUser.blocker_id == user_b_id, BlockedUser.blocked_id == user_a_id)
            )
        ).first() is not None

    @staticmethod
    def list_blocked_users(db: Session, user_id: int) -> List[Dict[str, Any]]:
        blocked = (
            db.query(BlockedUser)
            .filter(BlockedUser.blocker_id == user_id)
            .all()
        )
        blocked_user_ids = [b.blocked_id for b in blocked]
        if not blocked_user_ids:
            return []

        users = db.query(User).filter(User.id.in_(blocked_user_ids)).all()
        return [u.to_dict(include_sensitive=False) for u in users]
