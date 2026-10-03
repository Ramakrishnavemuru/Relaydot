from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_, or_, func, select

from app.models.story import Story
from app.models.story_view import StoryView
from app.models.user import User
from app.models.block import BlockedUser
from app.models.social import Follow
from app.schemas.story import StoryCreate
from app.services.conversation_service import ConversationService
from app.services.message_service import MessageService
from app.schemas.message import MessageCreate
from app.utils.helpers import sanitize_text


class StoryService:
    @staticmethod
    def create_story(db: Session, user: User, data: StoryCreate) -> Dict[str, Any]:
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(hours=24)

        story = Story(
            user_id=user.id,
            media_url=data.media_url,
            media_type=data.media_type or "IMAGE",
            caption=sanitize_text(data.caption) if data.caption else None,
            visibility=data.visibility,
            created_at=now,
            expires_at=expires_at
        )
        db.add(story)
        db.commit()
        db.refresh(story)

        return StoryService._format_story(db, story, current_user_id=user.id)

    @staticmethod
    def get_active_stories(db: Session, current_user_id: int) -> List[Dict[str, Any]]:
        now = datetime.now(timezone.utc)

        # Exclude blocked users
        blocked_pairs = db.query(BlockedUser).filter(
            or_(
                BlockedUser.blocker_id == current_user_id,
                BlockedUser.blocked_id == current_user_id
            )
        ).all()
        excluded_ids = set()
        for b in blocked_pairs:
            if b.blocker_id == current_user_id:
                excluded_ids.add(b.blocked_id)
            if b.blocked_id == current_user_id:
                excluded_ids.add(b.blocker_id)

        following = {r[0] for r in db.query(Follow.following_id).filter_by(follower_id=current_user_id)}
        followers = {r[0] for r in db.query(Follow.follower_id).filter_by(following_id=current_user_id)}
        query = (
            db.query(Story, User)
            .join(User, User.id == Story.user_id)
            .filter(
                Story.expires_at > now,
                ~Story.user_id.in_(excluded_ids) if excluded_ids else True,
                or_(Story.visibility == "EVERYONE", Story.user_id == current_user_id,
                    and_(Story.visibility == "FOLLOWERS", Story.user_id.in_(following or [-1])),
                    and_(Story.visibility == "FRIENDS", Story.user_id.in_((following & followers) or [-1])))
            )
            .order_by(desc(Story.created_at))
        )

        results = query.all()
        if not results:
            return []

        # Group stories by user
        grouped: Dict[int, Dict[str, Any]] = {}

        for story, user in results:
            story_dict = StoryService._format_story(db, story, current_user_id=current_user_id)

            if user.id not in grouped:
                grouped[user.id] = {
                    "user_id": user.id,
                    "username": user.username,
                    "display_name": user.display_name or user.username,
                    "avatar_url": user.avatar_url,
                    "all_viewed": True,
                    "stories": []
                }

            grouped[user.id]["stories"].append(story_dict)
            if not story_dict["is_viewed"] and user.id != current_user_id:
                grouped[user.id]["all_viewed"] = False

        # Sort: current user's group first, then unviewed stories, then viewed stories
        groups_list = list(grouped.values())
        groups_list.sort(key=lambda g: (
            0 if g["user_id"] == current_user_id else 1,
            0 if not g["all_viewed"] else 1
        ))

        return groups_list

    @staticmethod
    def record_view(db: Session, story_id: int, viewer_id: int) -> bool:
        now = datetime.now(timezone.utc)
        story = db.query(Story).filter(
            Story.id == story_id,
            Story.expires_at > now
        ).first()

        if not story:
            return False
        if not StoryService.can_view(db, story, viewer_id):
            raise HTTPException(status_code=404, detail="Story not found.")

        # Don't record view if viewing own story
        if story.user_id == viewer_id:
            return False

        existing = db.query(StoryView).filter(
            StoryView.story_id == story_id,
            StoryView.viewer_id == viewer_id
        ).first()

        if not existing:
            view = StoryView(
                story_id=story_id,
                viewer_id=viewer_id,
                viewed_at=now
            )
            db.add(view)
            db.commit()
            return True

        return False

    @staticmethod
    def get_story_views(db: Session, story_id: int, user_id: int) -> List[Dict[str, Any]]:
        story = db.query(Story).filter(Story.id == story_id).first()
        if not story:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Story not found.")

        if story.user_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the story author can see who viewed it."
            )

        views = (
            db.query(StoryView, User)
            .join(User, User.id == StoryView.viewer_id)
            .filter(StoryView.story_id == story_id)
            .order_by(desc(StoryView.viewed_at))
            .all()
        )

        return [
            {
                "viewer_id": u.id,
                "viewer_name": u.display_name or u.username,
                "viewer_username": u.username,
                "viewer_avatar": u.avatar_url,
                "viewed_at": v.viewed_at.isoformat()
            }
            for v, u in views
        ]

    @staticmethod
    def delete_story(db: Session, story_id: int, user_id: int) -> None:
        story = db.query(Story).filter(Story.id == story_id).first()
        if not story:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Story not found.")

        if story.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete someone else's story.")

        db.delete(story)
        db.commit()

    @staticmethod
    async def reply_to_story(db: Session, story_id: int, sender: User, text: str) -> Dict[str, Any]:
        story = db.query(Story).filter(Story.id == story_id).first()
        if not story:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Story not found.")

        if story.user_id == sender.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot reply to your own story.")
        if not StoryService.can_view(db, story, sender.id):
            raise HTTPException(status_code=404, detail="Story not found.")

        # Get or create 1-to-1 conversation with story author
        conv = ConversationService.get_or_create_direct_conversation(db, sender.id, story.user_id)

        # Send direct message quoting story
        reply_content = f"Replying to story: {sanitize_text(text)}"
        msg_create = MessageCreate(
            conversation_id=conv.id,
            content=reply_content,
            message_type="TEXT"
        )
        return await MessageService.send_message(db, sender.id, msg_create)

    @staticmethod
    def _format_story(db: Session, story: Story, current_user_id: int) -> Dict[str, Any]:
        user = db.query(User).filter(User.id == story.user_id).first()
        user_dict = user.to_dict(include_sensitive=False) if user else None

        views_count = db.query(func.count(StoryView.id)).filter(StoryView.story_id == story.id).scalar() or 0
        is_viewed = db.query(StoryView).filter(
            StoryView.story_id == story.id,
            StoryView.viewer_id == current_user_id
        ).first() is not None

        return {
            "id": story.id,
            "user_id": story.user_id,
            "media_url": story.media_url,
            "media_type": story.media_type,
            "caption": story.caption,
            "visibility": story.visibility,
            "created_at": story.created_at.isoformat(),
            "expires_at": story.expires_at.isoformat(),
            "views_count": views_count,
            "is_viewed": is_viewed,
            "is_own": story.user_id == current_user_id,
            "user": user_dict
        }

    @staticmethod
    def can_view(db: Session, story: Story, viewer_id: int) -> bool:
        if story.user_id == viewer_id:
            return True
        expires = story.expires_at.replace(tzinfo=timezone.utc) if story.expires_at.tzinfo is None else story.expires_at
        if expires < datetime.now(timezone.utc) or db.query(BlockedUser.id).filter(
            or_(and_(BlockedUser.blocker_id == viewer_id, BlockedUser.blocked_id == story.user_id),
                and_(BlockedUser.blocker_id == story.user_id, BlockedUser.blocked_id == viewer_id))).first():
            return False
        if story.visibility == "EVERYONE":
            return True
        follows = db.query(Follow.id).filter_by(follower_id=viewer_id, following_id=story.user_id).first()
        if story.visibility == "FOLLOWERS":
            return bool(follows)
        if story.visibility == "FRIENDS":
            return bool(follows and db.query(Follow.id).filter_by(follower_id=story.user_id, following_id=viewer_id).first())
        return False
