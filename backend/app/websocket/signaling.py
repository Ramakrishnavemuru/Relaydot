"""Authenticated, call-scoped WebRTC signaling for one-to-one calls.

State is intentionally per process. Deploy one ASGI worker unless this registry and the
WebSocket connection manager are moved to a shared store/broker.
"""
import asyncio
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.user import User
from app.models.conversation import Conversation, ConversationMember
from app.services.settings_service import get_settings, policy_allows
from app.websocket.manager import manager
from app.websocket.events import create_event
from app.websocket.call_events import (
    EVENT_CALL_INVITE, EVENT_CALL_ACCEPT, EVENT_CALL_REJECT, EVENT_WEBRTC_OFFER,
    EVENT_WEBRTC_ANSWER, EVENT_ICE_CANDIDATE, EVENT_CALL_END,
)

@dataclass
class ActiveCall:
    call_id: str
    caller_id: int
    callee_id: int
    call_type: str
    phase: str
    expires_at: float
    offer_pending: bool = False


_calls: dict[str, ActiveCall] = {}
_lock = asyncio.Lock()


def _prune() -> None:
    now = time.monotonic()
    for call_id, call in tuple(_calls.items()):
        if call.expires_at <= now:
            _calls.pop(call_id, None)


def _valid_id(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        return str(UUID(value)) if len(value) <= 36 else None
    except (ValueError, AttributeError):
        return None


def _other(call: ActiveCall, sender_id: int) -> int:
    return call.callee_id if sender_id == call.caller_id else call.caller_id


async def _error(sender_id: int, call_id: str | None, message: str) -> None:
    await manager.send_to_user(sender_id, create_event("call_error", {
        "call_id": call_id, "message": message}))


class CallSignalingHandler:
    @staticmethod
    async def handle_signaling_event(event_type: str, data: dict[str, Any], sender: User,
                                     db: Session) -> bool:
        if not isinstance(data, dict):
            await _error(sender.id, None, "Invalid call signal")
            return True
        call_id = _valid_id(data.get("call_id"))
        try:
            target_id = int(data.get("target_user_id"))
        except (ValueError, TypeError):
            target_id = -1
        if not call_id or target_id <= 0 or target_id == sender.id:
            await _error(sender.id, call_id, "Invalid call signal")
            return True
        description = None
        candidate = None
        if event_type in {EVENT_WEBRTC_OFFER, EVENT_WEBRTC_ANSWER}:
            field = "offer" if event_type == EVENT_WEBRTC_OFFER else "answer"
            description = data.get(field)
            if not isinstance(description, dict) or description.get("type") != field or not isinstance(
                    description.get("sdp"), str) or not 0 < len(description["sdp"]) <= 100_000:
                await _error(sender.id, call_id, "Invalid session description")
                return True
        elif event_type == EVENT_ICE_CANDIDATE:
            candidate = data.get("candidate")
            if not isinstance(candidate, dict) or not isinstance(candidate.get("candidate"), str) or len(candidate["candidate"]) > 8192:
                await _error(sender.id, call_id, "Invalid ICE candidate")
                return True
        if event_type == EVENT_CALL_INVITE:
            target = db.get(User, target_id)
            if not target or not target.is_verified or target.account_state != "ACTIVE" or sender.account_state != "ACTIVE":
                await _error(sender.id, call_id, "This account is unavailable for calls")
                return True
            if not policy_allows(db, target_id, sender.id, "dm_policy"):
                await _error(sender.id, call_id, "This account does not allow calls from you")
                return True
            shared_direct = select(ConversationMember.conversation_id).join(
                Conversation, Conversation.id == ConversationMember.conversation_id).where(
                ConversationMember.user_id == sender.id, Conversation.type == "DIRECT")
            muted = db.query(ConversationMember.id).filter(
                ConversationMember.user_id == target_id,
                ConversationMember.mute_calls.is_(True),
                ConversationMember.conversation_id.in_(shared_direct)).first()
            prefs = get_settings(db, target_id)
            if muted or (prefs and not prefs.call_notifications):
                await _error(sender.id, call_id, "This contact is not accepting calls")
                return True
            if data.get("call_type") not in {"audio", "video"}:
                await _error(sender.id, call_id, "Invalid call type")
                return True
            if not manager.is_user_online(target_id):
                await _error(sender.id, call_id, "This contact is offline")
                return True
            busy = False
            async with _lock:
                _prune()
                if call_id in _calls or any(sender.id in (c.caller_id, c.callee_id) or
                                              target_id in (c.caller_id, c.callee_id)
                                              for c in _calls.values()):
                    busy = True
                else:
                    _calls[call_id] = ActiveCall(call_id, sender.id, target_id,
                                                 data["call_type"], "invited", time.monotonic() + 45)
            if busy:
                await _error(sender.id, call_id, "This contact or your account is busy")
                return True
            delivered = await manager.send_to_user(target_id, create_event(EVENT_CALL_INVITE, {
                "call_id": call_id, "caller_id": sender.id,
                "caller_name": sender.display_name or sender.username,
                "caller_avatar": sender.avatar_url, "call_type": data["call_type"]}))
            if not delivered:
                async with _lock:
                    _calls.pop(call_id, None)
                await _error(sender.id, call_id, "This contact is offline")
            return True

        async with _lock:
            _prune()
            call = _calls.get(call_id)
            if (not call or sender.id not in (call.caller_id, call.callee_id) or
                    target_id != _other(call, sender.id) or
                    not policy_allows(db, call.callee_id, call.caller_id, "dm_policy")):
                call = None
            if call and event_type == EVENT_CALL_ACCEPT:
                if sender.id != call.callee_id or call.phase != "invited":
                    call = None
                else:
                    call.phase = "accepted"
                    call.expires_at = time.monotonic() + 120
            elif call and event_type == EVENT_CALL_REJECT:
                if sender.id != call.callee_id or call.phase != "invited":
                    call = None
                else:
                    _calls.pop(call_id, None)
            elif call and event_type == EVENT_CALL_END:
                _calls.pop(call_id, None)
            elif call and event_type in {EVENT_WEBRTC_OFFER, EVENT_WEBRTC_ANSWER, EVENT_ICE_CANDIDATE}:
                if call.phase != "accepted" or (event_type == EVENT_WEBRTC_OFFER and sender.id != call.caller_id) or (
                    event_type == EVENT_WEBRTC_ANSWER and (sender.id != call.callee_id or not call.offer_pending)):
                    call = None
                else:
                    if event_type == EVENT_WEBRTC_OFFER:
                        call.offer_pending = True
                    elif event_type == EVENT_WEBRTC_ANSWER:
                        call.offer_pending = False
                    call.expires_at = time.monotonic() + 12 * 3600
        if not call:
            await _error(sender.id, call_id, "Call expired or signal not allowed")
            return True

        if event_type in {EVENT_WEBRTC_OFFER, EVENT_WEBRTC_ANSWER}:
            field = "offer" if event_type == EVENT_WEBRTC_OFFER else "answer"
            forwarded = {"call_id": call_id, "sender_id": sender.id, field: description}
        elif event_type == EVENT_ICE_CANDIDATE:
            forwarded = {"call_id": call_id, "sender_id": sender.id, "candidate": candidate}
        else:
            forwarded = {"call_id": call_id, "sender_id": sender.id}
            if event_type == EVENT_CALL_REJECT:
                forwarded["reason"] = data.get("reason") if data.get("reason") in {"declined", "busy"} else "unavailable"
            if event_type == EVENT_CALL_ACCEPT:
                forwarded["call_type"] = call.call_type
        delivered = await manager.send_to_user(target_id, create_event(event_type, forwarded))
        if event_type in {EVENT_CALL_ACCEPT, EVENT_CALL_REJECT}:
            await manager.send_to_user(sender.id, create_event(event_type, {
                "call_id": call_id, "sender_id": sender.id, "accepted_elsewhere": event_type == EVENT_CALL_ACCEPT}))
        if not delivered and event_type not in {EVENT_CALL_END, EVENT_CALL_REJECT}:
            async with _lock:
                _calls.pop(call_id, None)
            await _error(sender.id, call_id, "The other caller disconnected")
        return True

    @staticmethod
    async def disconnected(user_id: int) -> None:
        async with _lock:
            ended = [call for call in _calls.values() if user_id in (call.caller_id, call.callee_id)]
            for call in ended:
                _calls.pop(call.call_id, None)
        for call in ended:
            await manager.send_to_user(_other(call, user_id), create_event(EVENT_CALL_END, {
                "call_id": call.call_id, "reason": "disconnected"}))
