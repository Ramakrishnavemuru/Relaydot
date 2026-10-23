import json
import logging
import asyncio
from datetime import datetime, timezone
from typing import Dict, Set, Optional, List
from fastapi import WebSocket
from sqlalchemy.orm import Session
from app.models.user import User
from app.models.conversation import ConversationMember
from app.services.chat_lock import is_chat_unlocked_token, lock_cookie_name
from app.websocket.events import create_event, EVENT_ONLINE, EVENT_OFFLINE

logger = logging.getLogger("websocket")


class ConnectionManager:
    def __init__(self):
        # Map user_id to a set of active WebSockets (supports multiple devices/tabs)
        self.active_connections: Dict[int, Set[WebSocket]] = {}
        self._send_locks: Dict[WebSocket, asyncio.Lock] = {}
        self._socket_sessions: Dict[WebSocket, str] = {}
        self._broadcast_batch_size = 16

    async def connect(self, websocket: WebSocket, user_id: int, db: Session,
                      session_id: str | None = None):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = set()
            # User transitioned from offline to online
            first_connection = True
        else:
            first_connection = False

        self.active_connections[user_id].add(websocket)
        self._send_locks[websocket] = asyncio.Lock()
        if session_id:
            self._socket_sessions[websocket] = session_id

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
            self._send_locks.pop(websocket, None)
            self._socket_sessions.pop(websocket, None)
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

    async def close_session(self, session_id: str) -> None:
        for socket, active_session in tuple(self._socket_sessions.items()):
            if active_session == session_id:
                try:
                    await socket.close(code=1008)
                except Exception:
                    pass

    async def close_other_sessions(self, user_id: int, current_session_id: str | None) -> None:
        for socket in tuple(self.active_connections.get(user_id, ())):
            session_id = self._socket_sessions.get(socket)
            if session_id and session_id != current_session_id:
                await self.close_session(session_id)

    def get_online_user_ids(self) -> Set[int]:
        return set(self.active_connections.keys())

    async def send_to_user(self, user_id: int, payload: dict,
                           member: ConversationMember | None = None) -> bool:
        """Send message payload to all active sockets of a given user."""
        if user_id not in self.active_connections:
            return False

        message_str = json.dumps(payload)
        locked_str = json.dumps({"event": "conversation_update", "data": {
            "conversation_id": member.conversation_id}}) if member and member.lock_pin_hash else None
        dead_sockets = set()
        delivered = False

        for ws in tuple(self.active_connections[user_id]):
            try:
                outgoing = message_str
                if member and locked_str and not is_chat_unlocked_token(
                        ws.cookies.get(lock_cookie_name(member.conversation_id)), member,
                        self._socket_sessions.get(ws)):
                    outgoing = locked_str
                lock = self._send_locks.setdefault(ws, asyncio.Lock())
                async with lock:
                    await ws.send_text(outgoing)
                delivered = True
            except Exception:
                logger.warning("Dropping an unresponsive WebSocket for user %s", user_id)
                dead_sockets.add(ws)

        for ws in dead_sockets:
            self.active_connections.get(user_id, set()).discard(ws)
            self._send_locks.pop(ws, None)

        return delivered

    async def broadcast_to_users(self, user_ids: List[int], payload: dict, exclude_user_id: Optional[int] = None):
        """Broadcast payload to a specific list of user IDs."""
        recipients = list(dict.fromkeys(uid for uid in user_ids if uid != exclude_user_id))
        for start in range(0, len(recipients), self._broadcast_batch_size):
            batch = recipients[start:start + self._broadcast_batch_size]
            if len(batch) <= 2:
                for uid in batch:
                    await self.send_to_user(uid, payload)
            else:
                await asyncio.gather(*(self.send_to_user(uid, payload) for uid in batch))

    async def broadcast_to_conversation(
        self,
        conversation_id: int,
        payload: dict,
        db: Session,
        exclude_user_id: Optional[int] = None
    ) -> List[int]:
        """Broadcast to all members of a conversation. Returns list of online member IDs who received it."""
        members = (
            db.query(ConversationMember)
            .filter(ConversationMember.conversation_id == conversation_id)
            .all()
        )
        delivered_to = []
        recipients = [member for member in members if member.user_id != exclude_user_id]
        for start in range(0, len(recipients), self._broadcast_batch_size):
            batch = recipients[start:start + self._broadcast_batch_size]
            if len(batch) <= 2:
                delivered = [await self.send_to_user(member.user_id, payload, member) for member in batch]
            else:
                delivered = await asyncio.gather(*(self.send_to_user(member.user_id, payload, member) for member in batch))
            delivered_to.extend(member.user_id for member, sent in zip(batch, delivered) if sent)

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
