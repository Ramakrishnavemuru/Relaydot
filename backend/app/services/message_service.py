from datetime import datetime, date, timedelta, timezone
from typing import List, Optional, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, asc, or_, and_, select, func

from app.models.conversation import Conversation, ConversationMember
from app.models.message import Message, MessageRead, MessageBookmark
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
        expires_at = message.expires_at.replace(tzinfo=timezone.utc) if message.expires_at and message.expires_at.tzinfo is None else message.expires_at
        is_deleted = bool(message.deleted_at or (expires_at and expires_at <= datetime.now(timezone.utc)))
        content = "This message was deleted" if is_deleted else message.content

        sender = db.query(User).filter(User.id == message.sender_id).first()
        sender_dict = sender.to_dict(include_sensitive=False) if sender else None

        # Reply-to info
        reply_dict = None
        if message.reply_to_id:
            reply_msg = db.query(Message).filter(Message.id == message.reply_to_id,
                Message.conversation_id == message.conversation_id).first()
            if reply_msg:
                reply_sender = db.query(User).filter(User.id == reply_msg.sender_id).first()
                reply_dict = {
                    "id": reply_msg.id,
                    "sender_id": reply_msg.sender_id,
                    "sender_name": (reply_sender.display_name or reply_sender.username) if reply_sender else "User",
                    "content": "This message was deleted" if reply_msg.deleted_at or (reply_msg.expires_at and reply_msg.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)) else reply_msg.content[:100],
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
            "thread_root_id": message.thread_root_id,
            "thread_reply_count": db.query(func.count(Message.id)).filter(
                Message.thread_root_id == message.id, Message.deleted_at.is_(None),
                or_(Message.expires_at.is_(None), Message.expires_at > datetime.now(timezone.utc))).scalar() or 0,
            "expires_at": message.expires_at.isoformat() if message.expires_at else None,
            "pinned_at": message.pinned_at.isoformat() if message.pinned_at else None,
            "bookmarked": bool(current_user_id and db.query(MessageBookmark.id).filter_by(
                message_id=message.id, user_id=current_user_id).first()),
            "is_forwarded": bool(message.is_forwarded),
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
    async def send_message(db: Session, sender_id: int, msg_data: MessageCreate,
                           scheduled_message_id: Optional[int] = None) -> Dict[str, Any]:
        conv_id = msg_data.conversation_id
        if scheduled_message_id:
            already_sent = db.query(Message).filter_by(scheduled_message_id=scheduled_message_id).first()
            if already_sent:
                return MessageService.get_message_response_dict(db, already_sent, sender_id)

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

        if msg_data.reply_to_id:
            replied = db.get(Message, msg_data.reply_to_id)
            if not replied or replied.conversation_id != conv_id or replied.deleted_at or (
                replied.expires_at and replied.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)):
                raise HTTPException(400, "Reply target is not available in this conversation")
        thread_root_id = None
        if msg_data.thread_root_id:
            root = db.get(Message, msg_data.thread_root_id)
            if not root or root.conversation_id != conv_id or root.deleted_at or (
                root.expires_at and root.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)):
                raise HTTPException(400, "Thread target is not available in this conversation")
            thread_root_id = root.thread_root_id or root.id
        if msg_data.message_type not in {"TEXT", "IMAGE", "FILE", "AUDIO", "VIDEO"}:
            raise HTTPException(400, "Unsupported message type")
        if not msg_data.content.strip() and not msg_data.attachments:
            raise HTTPException(400, "Message cannot be empty")

        # Create message record
        new_msg = Message(
            conversation_id=conv_id,
            sender_id=sender_id,
            content=sanitize_text(msg_data.content),
            message_type=msg_data.message_type or "TEXT",
            reply_to_id=msg_data.reply_to_id,
            thread_root_id=thread_root_id,
            is_forwarded=msg_data.is_forwarded,
            scheduled_message_id=scheduled_message_id,
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=msg_data.expires_in_seconds) if msg_data.expires_in_seconds else None,
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
        if thread_root_id:
            await manager.broadcast_to_conversation(conv_id, {"event": "thread.reply.created", "data": {
                "conversation_id": conv_id, "thread_root_id": thread_root_id, "message_id": new_msg.id}}, db=db)

        # Keep message activity in the same notification inbox as social events.
        from app.models.social import SocialNotification
        recipients = db.query(ConversationMember.user_id).filter(
            ConversationMember.conversation_id == conv_id,
            ConversationMember.user_id != sender_id).all()
        for (recipient_id,) in recipients:
            if UserService.is_blocked(db, sender_id, recipient_id):
                continue
            item = SocialNotification(recipient_id=recipient_id, actor_id=sender_id,
                type="message", entity_type="conversation", entity_id=conv_id)
            db.add(item)
            db.flush()
            await manager.send_to_user(recipient_id, {"event": "social_notification", "data": {
                "id": item.id, "type": "message", "entity_type": "conversation",
                "entity_id": conv_id, "read": False,
                "created_at": item.created_at.isoformat(),
                "actor": db.get(User, sender_id).to_dict(False)
            }})
        if thread_root_id:
            root = db.get(Message, thread_root_id)
            root_is_member = root and db.query(ConversationMember.id).filter_by(
                conversation_id=conv_id, user_id=root.sender_id).first()
            if root_is_member and root.sender_id != sender_id and not UserService.is_blocked(db, sender_id, root.sender_id):
                thread_notice = SocialNotification(recipient_id=root.sender_id, actor_id=sender_id,
                    type="thread_reply", entity_type="conversation", entity_id=conv_id)
                db.add(thread_notice)
                db.flush()
                await manager.send_to_user(root.sender_id, {"event":"social_notification", "data":{
                    "id":thread_notice.id,"type":"thread_reply","entity_type":"conversation",
                    "entity_id":conv_id,"read":False,"created_at":thread_notice.created_at.isoformat(),
                    "actor":db.get(User, sender_id).to_dict(False)}})
        db.commit()

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

        if msg.deleted_at or (msg.expires_at and msg.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)):
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
        if msg.deleted_at or (msg.expires_at and msg.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)):
            raise HTTPException(status_code=404, detail="Message not found.")

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
        member = db.query(ConversationMember).filter_by(conversation_id=conversation_id, user_id=user_id).first()
        if not member:
            raise HTTPException(status_code=403, detail="Not a conversation member.")
        # Find messages in conversation not sent by user and not yet read by user
        read_subquery = select(MessageRead.message_id).filter(MessageRead.user_id == user_id)

        unread_messages = (
            db.query(Message)
            .filter(
                Message.conversation_id == conversation_id,
                Message.sender_id != user_id,
                Message.deleted_at.is_(None),
                or_(Message.expires_at.is_(None), Message.expires_at > datetime.now(timezone.utc)),
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

        query = db.query(Message).filter(Message.conversation_id == conversation_id,
            Message.thread_root_id.is_(None))
        if before_id:
            query = query.filter(Message.id < before_id)

        messages = query.order_by(desc(Message.created_at)).limit(limit).all()
        # Reverse to show oldest first in the page
        messages.reverse()

        return [MessageService.get_message_response_dict(db, m, current_user_id=user_id) for m in messages]

    @staticmethod
    def search_messages(db: Session, user_id: int, query_str: str,
                        conversation_id: Optional[int] = None, sender: Optional[str] = None,
                        before: Optional[date] = None, after: Optional[date] = None,
                        has: Optional[str] = None, limit: int = 30,
                        offset: int = 0) -> List[Dict[str, Any]]:
        clean_q = query_str.strip()
        if not any((clean_q, conversation_id, sender, before, after, has)):
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

        query = (
            db.query(Message, Conversation, User)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .join(User, User.id == Message.sender_id)
            .filter(
                Message.conversation_id.in_(conv_ids),
                Message.deleted_at.is_(None),
                or_(Message.expires_at.is_(None), Message.expires_at > datetime.now(timezone.utc)),
            )
        )
        if clean_q:
            escaped = clean_q.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')
            query = query.filter(Message.content.ilike(f"%{escaped}%", escape='\\'))
        if conversation_id:
            query = query.filter(Message.conversation_id == conversation_id)
        if sender:
            query = query.filter(User.username.ilike(sender.strip()))
        if before:
            query = query.filter(Message.created_at < datetime.combine(before + timedelta(days=1), datetime.min.time()))
        if after:
            query = query.filter(Message.created_at >= datetime.combine(after, datetime.min.time()))
        if has:
            attachment = db.query(Attachment.id).filter(Attachment.message_id == Message.id)
            if has == 'image':
                attachment = attachment.filter(Attachment.file_type.like('image/%'))
            query = query.filter(attachment.exists())
        messages = query.order_by(desc(Message.created_at), desc(Message.id)).offset(offset).limit(limit).all()

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
