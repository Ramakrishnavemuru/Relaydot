from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func, desc, select

from app.models.conversation import Conversation, ConversationMember
from app.models.message import Message, MessageRead
from app.models.user import User
from app.schemas.conversation import GroupCreate, GroupUpdate
from app.services.user_service import UserService
from app.utils.helpers import sanitize_text, get_default_avatar


class ConversationService:
    @staticmethod
    def get_or_create_direct_conversation(db: Session, user1_id: int, user2_id: int) -> Conversation:
        if user1_id == user2_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot create a conversation with yourself."
            )

        # Check if either user has blocked the other
        if UserService.is_blocked(db, user1_id, user2_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot start a conversation with a blocked user."
            )

        # Find existing DIRECT conversation that contains both user1 and user2
        conv_ids_user1 = (
            select(ConversationMember.conversation_id)
            .join(Conversation, Conversation.id == ConversationMember.conversation_id)
            .filter(Conversation.type == "DIRECT", ConversationMember.user_id == user1_id)
        )

        existing_member = (
            db.query(ConversationMember)
            .filter(
                ConversationMember.conversation_id.in_(conv_ids_user1),
                ConversationMember.user_id == user2_id
            )
            .first()
        )

        if existing_member:
            return db.query(Conversation).filter(Conversation.id == existing_member.conversation_id).first()

        # Create new DIRECT conversation
        conv = Conversation(
            type="DIRECT",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        db.add(conv)
        db.flush()

        # Add both members
        member1 = ConversationMember(conversation_id=conv.id, user_id=user1_id, role="MEMBER")
        member2 = ConversationMember(conversation_id=conv.id, user_id=user2_id, role="MEMBER")
        db.add_all([member1, member2])
        db.commit()
        db.refresh(conv)
        return conv

    @staticmethod
    def create_group(db: Session, creator_id: int, group_data: GroupCreate) -> Conversation:
        name = sanitize_text(group_data.name)
        avatar = group_data.avatar_url or get_default_avatar(name)
        description = sanitize_text(group_data.description) if group_data.description else None

        conv = Conversation(
            type="GROUP",
            name=name,
            avatar_url=avatar,
            description=description,
            created_by_id=creator_id,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        db.add(conv)
        db.flush()

        # Creator is ADMIN
        admin_member = ConversationMember(
            conversation_id=conv.id,
            user_id=creator_id,
            role="ADMIN"
        )
        db.add(admin_member)

        # Add other initial members
        member_ids = set(group_data.member_ids)
        member_ids.discard(creator_id)

        for mid in member_ids:
            # Check user exists and is not blocked
            user = db.query(User).filter(User.id == mid).first()
            if user and not UserService.is_blocked(db, creator_id, mid):
                m = ConversationMember(
                    conversation_id=conv.id,
                    user_id=mid,
                    role="MEMBER"
                )
                db.add(m)

        db.commit()
        db.refresh(conv)
        return conv

    @staticmethod
    def update_group(db: Session, conversation_id: int, user_id: int, update_data: GroupUpdate) -> Conversation:
        from app.models.social import Community
        if db.query(Community.id).filter_by(conversation_id=conversation_id).first():
            raise HTTPException(403, "Manage community details through the community page")
        conv = ConversationService.get_conversation_or_404(db, conversation_id, user_id)
        if conv.type != "GROUP":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only group conversations can be updated."
            )

        # Check if user is ADMIN
        membership = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id
        ).first()

        if not membership or membership.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only group admins can update group details."
            )

        if update_data.name is not None:
            conv.name = sanitize_text(update_data.name)
        if update_data.avatar_url is not None:
            conv.avatar_url = update_data.avatar_url
        if update_data.description is not None:
            conv.description = sanitize_text(update_data.description)

        conv.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(conv)
        return conv

    @staticmethod
    def add_member(db: Session, conversation_id: int, admin_user_id: int, target_user_id: int, role: str = "MEMBER") -> ConversationMember:
        from app.models.social import Community
        if db.query(Community.id).filter_by(conversation_id=conversation_id).first():
            raise HTTPException(403, "Join and manage members through the community page")
        conv = ConversationService.get_conversation_or_404(db, conversation_id, admin_user_id)
        if conv.type != "GROUP":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot add members to direct messages."
            )

        admin_membership = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == admin_user_id
        ).first()

        if not admin_membership or admin_membership.role != "ADMIN":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only group admins can add members."
            )

        # Check target user exists
        target = db.query(User).filter(User.id == target_user_id).first()
        if not target:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found."
            )

        # Check if already a member
        existing = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == target_user_id
        ).first()

        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User is already a member of this group."
            )

        new_member = ConversationMember(
            conversation_id=conversation_id,
            user_id=target_user_id,
            role=role if role in ["ADMIN", "MEMBER"] else "MEMBER"
        )
        db.add(new_member)
        conv.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(new_member)
        return new_member

    @staticmethod
    def remove_member(db: Session, conversation_id: int, requester_id: int, target_user_id: int) -> None:
        from app.models.social import Community
        if db.query(Community.id).filter_by(conversation_id=conversation_id).first():
            raise HTTPException(403, "Leave and manage members through the community page")
        conv = ConversationService.get_conversation_or_404(db, conversation_id, requester_id)
        if conv.type != "GROUP":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove members from direct messages."
            )

        # If requester is removing someone else, requester must be ADMIN
        if requester_id != target_user_id:
            admin_membership = db.query(ConversationMember).filter(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == requester_id
            ).first()

            if not admin_membership or admin_membership.role != "ADMIN":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only group admins can remove other members."
                )

        target_member = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == target_user_id
        ).first()

        if not target_member:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Member not found in this group."
            )

        db.delete(target_member)
        conv.updated_at = datetime.now(timezone.utc)
        db.commit()

    @staticmethod
    def get_conversation_or_404(db: Session, conversation_id: int, user_id: int) -> Conversation:
        # User must be an active member of this conversation
        membership = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id
        ).first()

        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of this conversation."
            )

        conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
        if not conv:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found."
            )

        return conv

    @staticmethod
    def list_user_conversations(db: Session, user_id: int) -> List[Dict[str, Any]]:
        # Get all conversation memberships for user
        memberships = (
            db.query(ConversationMember)
            .filter(ConversationMember.user_id == user_id)
            .all()
        )
        conv_ids = [m.conversation_id for m in memberships]
        if not conv_ids:
            return []

        convs = (
            db.query(Conversation)
            .filter(Conversation.id.in_(conv_ids))
            .order_by(desc(Conversation.updated_at))
            .all()
        )

        result = []
        for c in convs:
            c_dict = {
                "id": c.id,
                "type": c.type,
                "name": c.name,
                "avatar_url": c.avatar_url,
                "description": c.description,
                "created_by_id": c.created_by_id,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "updated_at": c.updated_at.isoformat() if c.updated_at else None,
                "members": [],
                "unread_count": 0,
                "last_message": None,
                "other_user": None
            }

            # Fetch members
            all_members = (
                db.query(ConversationMember, User)
                .join(User, User.id == ConversationMember.user_id)
                .filter(ConversationMember.conversation_id == c.id)
                .all()
            )

            for cm, u in all_members:
                user_dict = u.to_dict(include_sensitive=False)
                c_dict["members"].append({
                    "id": cm.id,
                    "conversation_id": cm.conversation_id,
                    "user_id": cm.user_id,
                    "role": cm.role,
                    "joined_at": cm.joined_at.isoformat() if cm.joined_at else None,
                    "is_muted": cm.is_muted,
                    "user": user_dict
                })
                if c.type == "DIRECT" and u.id != user_id:
                    c_dict["other_user"] = user_dict
                    c_dict["name"] = user_dict.get("display_name") or user_dict.get("username")
                    c_dict["avatar_url"] = user_dict.get("avatar_url")

            # Last message
            last_msg = (
                db.query(Message, User)
                .join(User, User.id == Message.sender_id)
                .filter(Message.conversation_id == c.id)
                .order_by(desc(Message.created_at))
                .first()
            )

            if last_msg:
                m, sender = last_msg
                c_dict["last_message"] = {
                    "id": m.id,
                    "sender_id": m.sender_id,
                    "sender_name": sender.display_name or sender.username,
                    "content": "This message was deleted" if m.deleted_at else m.content,
                    "message_type": m.message_type,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                    "is_deleted": bool(m.deleted_at)
                }

            # Unread count
            # Unread messages are messages in c.id not sent by user_id and without a MessageRead record for user_id
            read_subquery = select(MessageRead.message_id).filter(MessageRead.user_id == user_id)
            unread_count = (
                db.query(func.count(Message.id))
                .filter(
                    Message.conversation_id == c.id,
                    Message.sender_id != user_id,
                    Message.deleted_at.is_(None),
                    or_(Message.expires_at.is_(None), Message.expires_at > datetime.now(timezone.utc)),
                    ~Message.id.in_(read_subquery)
                )
                .scalar() or 0
            )
            c_dict["unread_count"] = unread_count

            result.append(c_dict)

        return result
