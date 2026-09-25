import json
import logging
from datetime import datetime, timezone
from typing import Dict, Set, Optional, List
from fastapi import WebSocket
from sqlalchemy.orm import Session
from app.models.user import User
from app.models.conversation import ConversationMember
from app.websocket.events import create_event, EVENT_ONLINE, EVENT_OFFLINE

logger = logging.getLogger("websocket")


class ConnectionManager:
    def __init__(self):
        # Map user_id to a set of active WebSockets (supports multiple devices/tabs)
        self.active_connections: Dict[int, Set[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: int, db: Session):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
            # User transitioned from offline to online
            first_connection = True
        else:
            first_connection = False

        self.active_connections[user_id].add(websocket)

        if first_connection:
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                user.is_online = True
                user.last_seen = datetime.now(timezone.utc)
                db.commit()

                # Broadcast online event to all users who share a conversation
                if user.show_online:
                    await self.broadcast_user_status(user_id, is_online=True, db=db)

    async def disconnect(self, websocket: WebSocket, user_id: int, db: Session):
        if user_id in self.active_connections:
            self.active_connections[user_id].discard(websocket)
            if len(self.active_connections[user_id]) == 0:
                del self.active_connections[user_id]
                # User is completely offline
                user = db.query(User).filter(User.id == user_id).first()
                if user:
                    user.is_online = False
                    user.last_seen = datetime.now(timezone.utc)
                    db.commit()

                    last_seen_str = user.last_seen.isoformat() if user.show_last_seen else None
                    await self.broadcast_user_status(user_id, is_online=False, last_seen=last_seen_str, db=db)

    def is_user_online(self, user_id: int) -> bool:
        return user_id in self.active_connections and len(self.active_connections[user_id]) > 0

    def get_online_user_ids(self) -> Set[int]:
        return set(self.active_connections.keys())

    async def send_to_user(self, user_id: int, payload: dict) -> bool:
        """Send message payload to all active sockets of a given user."""
        if user_id not in self.active_connections:
            return False

        message_str = json.dumps(payload)
        dead_sockets = set()
        delivered = False

        for ws in self.active_connections[user_id]:
            try:
                await ws.send_text(message_str)
                delivered = True
            except Exception as e:
                logger.error(f"Error sending message to user {user_id}: {e}")
                dead_sockets.add(ws)

        for ws in dead_sockets:
            self.active_connections[user_id].discard(ws)

        return delivered

    async def broadcast_to_users(self, user_ids: List[int], payload: dict, exclude_user_id: Optional[int] = None):
        """Broadcast payload to a specific list of user IDs."""
        for uid in user_ids:
            if exclude_user_id is not None and uid == exclude_user_id:
                continue
            await self.send_to_user(uid, payload)

    async def broadcast_to_conversation(
        self,
        conversation_id: int,
        payload: dict,
        db: Session,
        exclude_user_id: Optional[int] = None
    ) -> List[int]:
        """Broadcast to all members of a conversation. Returns list of online member IDs who received it."""
        members = (
            db.query(ConversationMember.user_id)
            .filter(ConversationMember.conversation_id == conversation_id)
            .all()
        )
        member_ids = [m[0] for m in members]
        delivered_to = []

        for uid in member_ids:
            if exclude_user_id is not None and uid == exclude_user_id:
                continue
            delivered = await self.send_to_user(uid, payload)
            if delivered:
                delivered_to.append(uid)

        return delivered_to

    async def broadcast_user_status(
        self,
        user_id: int,
        is_online: bool,
        db: Session,
        last_seen: Optional[str] = None
    ):
        """Notify all conversation contacts about user's online/offline status change."""
        # Find all unique users that share a conversation with user_id
        shared_convs = (
            db.query(ConversationMember.conversation_id)
            .filter(ConversationMember.user_id == user_id)
            .all()
        )
        conv_ids = [c[0] for c in shared_convs]

        if not conv_ids:
            return

        contact_members = (
            db.query(ConversationMember.user_id)
            .filter(
                ConversationMember.conversation_id.in_(conv_ids),
                ConversationMember.user_id != user_id
            )
            .distinct()
            .all()
        )
        contact_ids = [m[0] for m in contact_members]

        event_type = EVENT_ONLINE if is_online else EVENT_OFFLINE
        payload = create_event(event_type, {
            "user_id": user_id,
            "is_online": is_online,
            "last_seen": last_seen
        })
        await self.broadcast_to_users(contact_ids, payload)


# Global instance
manager = ConnectionManager()
