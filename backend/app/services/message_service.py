from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, or_, and_, select

from app.models.conversation import Conversation, ConversationMember
from app.models.message import Message, MessageRead
from app.models.reaction import MessageReaction
from app.models.attachment import Attachment
from app.models.user import User
from app.schemas.message import MessageCreate, MessageEdit
from app.services.user_service import UserService
from app.utils.helpers import sanitize_text
from app.websocket.manager import manager
from app.websocket.events import (
    create_event,
    EVENT_MESSAGE,
    EVENT_MESSAGE_EDIT,
    EVENT_MESSAGE_DELETE,
    EVENT_REACTION,
    EVENT_READ
)


class MessageService:
    @staticmethod
    def get_message_response_dict(db: Session, message: Message, current_user_id: Optional[int] = None) -> Dict[str, Any]:
        """Convert a Message model to a complete JSON-ready response dictionary."""
        is_deleted = bool(message.deleted_at)
        content = "This message was deleted" if is_deleted else message.content

        sender = db.query(User).filter(User.id == message.sender_id).first()
        sender_dict = sender.to_dict(include_sensitive=False) if sender else None

        # Reply-to info
        reply_dict = None
        if message.reply_to_id:
            reply_msg = db.query(Message).filter(Message.id == message.reply_to_id).first()
            if reply_msg:
                reply_sender = db.query(User).filter(User.id == reply_msg.sender_id).first()
                reply_dict = {
                    "id": reply_msg.id,
                    "sender_id": reply_msg.sender_id,
                    "sender_name": (reply_sender.display_name or reply_sender.username) if reply_sender else "User",
                    "content": "This message was deleted" if reply_msg.deleted_at else reply_msg.content[:100],
                    "message_type": reply_msg.message_type
                }

        # Attachments
        attachments_list = []
        if not is_deleted:
            atts = db.query(Attachment).filter(Attachment.message_id == message.id).all()
            for a in atts:
                attachments_list.append({
                    "id": a.id,
                    "message_id": a.message_id,
                    "file_url": a.file_url,
                    "file_name": a.file_name,
                    "file_type": a.file_type,
                    "file_size": a.file_size,
                    "public_id": a.public_id,
                    "created_at": a.created_at.isoformat() if a.created_at else None
                })

        # Reactions
        reactions_list = []
        rxns = db.query(MessageReaction, User).join(User, User.id == MessageReaction.user_id).filter(
            MessageReaction.message_id == message.id
        ).all()
        for r, u in rxns:
            reactions_list.append({
                "id": r.id,
                "message_id": r.message_id,
                "user_id": r.user_id,
                "emoji": r.emoji,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "user": u.to_dict(include_sensitive=False)
            })

        # Reads
        reads = db.query(MessageRead).filter(MessageRead.message_id == message.id).all()
        read_by_ids = [r.user_id for r in reads]

        # Determine status: SENT, DELIVERED, READ
        status_val = "SENT"
        conv = db.query(Conversation).filter(Conversation.id == message.conversation_id).first()
        if conv and conv.type == "DIRECT":
            other_member = db.query(ConversationMember).filter(
                ConversationMember.conversation_id == conv.id,
                ConversationMember.user_id != message.sender_id
            ).first()
            if other_member:
                if other_member.user_id in read_by_ids:
                    status_val = "READ"
                elif manager.is_user_online(other_member.user_id):
                    status_val = "DELIVERED"
        else:
            # Group chat
            if read_by_ids:
                status_val = "READ"

        return {
            "id": message.id,
            "conversation_id": message.conversation_id,
            "sender_id": message.sender_id,
            "content": content,
            "message_type": message.message_type,
            "reply_to_id": message.reply_to_id,
            "reply_to": reply_dict,
            "created_at": message.created_at.isoformat() if message.created_at else None,
            "updated_at": message.updated_at.isoformat() if message.updated_at else None,
            "deleted_at": message.deleted_at.isoformat() if message.deleted_at else None,
            "is_deleted": is_deleted,
            "is_edited": bool(message.updated_at and not message.deleted_at),
            "sender": sender_dict,
            "attachments": attachments_list,
            "reactions": reactions_list,
            "status": status_val,
            "read_by": read_by_ids
        }

    @staticmethod
    async def send_message(db: Session, sender_id: int, msg_data: MessageCreate) -> Dict[str, Any]:
        conv_id = msg_data.conversation_id

        # Verify sender is member of conversation
        membership = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conv_id,
            ConversationMember.user_id == sender_id
        ).first()

        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of this conversation."
            )

        conv = db.query(Conversation).filter(Conversation.id == conv_id).first()
        if not conv:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found."
            )

        # In DIRECT chat, verify neither party blocked the other
        if conv.type == "DIRECT":
            other = db.query(ConversationMember).filter(
                ConversationMember.conversation_id == conv_id,
                ConversationMember.user_id != sender_id
            ).first()
            if other and UserService.is_blocked(db, sender_id, other.user_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Cannot send messages because one of the users is blocked."
                )

        # Create message record
        new_msg = Message(
            conversation_id=conv_id,
            sender_id=sender_id,
            content=sanitize_text(msg_data.content),
            message_type=msg_data.message_type or "TEXT",
            reply_to_id=msg_data.reply_to_id,
            created_at=datetime.now(timezone.utc)
        )
        db.add(new_msg)
        db.flush()

        # Handle attachments if any
        if msg_data.attachments:
            for att in msg_data.attachments:
                a_record = Attachment(
                    message_id=new_msg.id,
                    file_url=att.file_url,
                    file_name=att.file_name,
                    file_type=att.file_type,
                    file_size=att.file_size,
                    public_id=att.public_id,
                    created_at=datetime.now(timezone.utc)
                )
                db.add(a_record)

        # Update conversation timestamp
        conv.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(new_msg)

        response_data = MessageService.get_message_response_dict(db, new_msg, current_user_id=sender_id)

        # Broadcast via WebSocket
        payload = create_event(EVENT_MESSAGE, response_data)
        await manager.broadcast_to_conversation(conv_id, payload, db=db, exclude_user_id=None)

        return response_data

    @staticmethod
    async def edit_message(db: Session, user_id: int, message_id: int, edit_data: MessageEdit) -> Dict[str, Any]:
        msg = db.query(Message).filter(Message.id == message_id).first()
        if not msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Message not found."
            )

        if msg.sender_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only edit your own messages."
            )

        if msg.deleted_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot edit a deleted message."
            )

        msg.content = sanitize_text(edit_data.content)
        msg.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(msg)

        resp = MessageService.get_message_response_dict(db, msg, current_user_id=user_id)
        payload = create_event(EVENT_MESSAGE_EDIT, resp)
        await manager.broadcast_to_conversation(msg.conversation_id, payload, db=db)

        return resp

    @staticmethod
    async def delete_message(db: Session, user_id: int, message_id: int) -> Dict[str, Any]:
        msg = db.query(Message).filter(Message.id == message_id).first()
        if not msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Message not found."
            )

        if msg.sender_id != user_id:
            # Check if group admin
            membership = db.query(ConversationMember).filter(
                ConversationMember.conversation_id == msg.conversation_id,
                ConversationMember.user_id == user_id
            ).first()
            if not membership or membership.role != "ADMIN":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You are not authorized to delete this message."
                )

        msg.deleted_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(msg)

        resp = MessageService.get_message_response_dict(db, msg, current_user_id=user_id)
        payload = create_event(EVENT_MESSAGE_DELETE, {
            "id": msg.id,
            "conversation_id": msg.conversation_id,
            "is_deleted": True,
            "content": "This message was deleted"
        })
        await manager.broadcast_to_conversation(msg.conversation_id, payload, db=db)

        return resp

    @staticmethod
    async def toggle_reaction(db: Session, user_id: int, message_id: int, emoji: str) -> Dict[str, Any]:
        msg = db.query(Message).filter(Message.id == message_id).first()
        if not msg:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found.")

        # Check membership
        membership = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == msg.conversation_id,
            ConversationMember.user_id == user_id
        ).first()
        if not membership:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a conversation member.")

        existing = db.query(MessageReaction).filter(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == user_id,
            MessageReaction.emoji == emoji
        ).first()

        action = "added"
        if existing:
            db.delete(existing)
            action = "removed"
        else:
            rxn = MessageReaction(
                message_id=message_id,
                user_id=user_id,
                emoji=emoji,
                created_at=datetime.now(timezone.utc)
            )
            db.add(rxn)

        db.commit()

        resp = MessageService.get_message_response_dict(db, msg, current_user_id=user_id)
        payload = create_event(EVENT_REACTION, {
            "message_id": message_id,
            "conversation_id": msg.conversation_id,
            "user_id": user_id,
            "emoji": emoji,
            "action": action,
            "reactions": resp["reactions"]
        })
        await manager.broadcast_to_conversation(msg.conversation_id, payload, db=db)

        return resp

    @staticmethod
    async def mark_as_read(db: Session, user_id: int, conversation_id: int) -> int:
        """Mark all unread messages in conversation as read by user."""
        # Find messages in conversation not sent by user and not yet read by user
        read_subquery = select(MessageRead.message_id).filter(MessageRead.user_id == user_id)

        unread_messages = (
            db.query(Message)
            .filter(
                Message.conversation_id == conversation_id,
                Message.sender_id != user_id,
                ~Message.id.in_(read_subquery)
            )
            .all()
        )

        if not unread_messages:
            return 0

        now = datetime.now(timezone.utc)
        marked_ids = []
        for m in unread_messages:
            db.add(MessageRead(message_id=m.id, user_id=user_id, read_at=now))
            marked_ids.append(m.id)

        # Update last_read_message_id on member record
        member = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id
        ).first()
        if member and marked_ids:
            member.last_read_message_id = max(marked_ids)

        db.commit()

        # Broadcast read receipt
        user = db.query(User).filter(User.id == user_id).first()
        if user and user.show_read_receipts:
            payload = create_event(EVENT_READ, {
                "conversation_id": conversation_id,
                "user_id": user_id,
                "message_ids": marked_ids,
                "read_at": now.isoformat()
            })
            await manager.broadcast_to_conversation(conversation_id, payload, db=db, exclude_user_id=user_id)

        return len(marked_ids)

    @staticmethod
    def get_messages(
        db: Session,
        conversation_id: int,
        user_id: int,
        limit: int = 50,
        before_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        # Check membership
        membership = db.query(ConversationMember).filter(
            ConversationMember.conversation_id == conversation_id,
            ConversationMember.user_id == user_id
        ).first()
        if not membership:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a conversation member.")

        query = db.query(Message).filter(Message.conversation_id == conversation_id)
        if before_id:
            query = query.filter(Message.id < before_id)

        messages = query.order_by(desc(Message.created_at)).limit(limit).all()
        # Reverse to show oldest first in the page
        messages.reverse()

        return [MessageService.get_message_response_dict(db, m, current_user_id=user_id) for m in messages]

    @staticmethod
    def search_messages(db: Session, user_id: int, query_str: str) -> List[Dict[str, Any]]:
        clean_q = query_str.strip()
        if not clean_q:
            return []

        # Find all conversations the user is a member of
        user_convs = (
            db.query(ConversationMember.conversation_id)
            .filter(ConversationMember.user_id == user_id)
            .all()
        )
        conv_ids = [c[0] for c in user_convs]
        if not conv_ids:
            return []

        messages = (
            db.query(Message, Conversation, User)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .join(User, User.id == Message.sender_id)
            .filter(
                Message.conversation_id.in_(conv_ids),
                Message.deleted_at.is_(None),
                Message.content.ilike(f"%{clean_q}%")
            )
            .order_by(desc(Message.created_at))
            .limit(30)
            .all()
        )

        results = []
        for m, conv, sender in messages:
            results.append({
                "message_id": m.id,
                "conversation_id": conv.id,
                "conversation_name": conv.name or (sender.display_name or sender.username),
                "conversation_type": conv.type,
                "sender_id": sender.id,
                "sender_name": sender.display_name or sender.username,
                "content": m.content,
                "created_at": m.created_at.isoformat() if m.created_at else None
            })
        return results
