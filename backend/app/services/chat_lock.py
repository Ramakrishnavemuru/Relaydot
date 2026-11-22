"""Per-member chat privacy lock. A short-lived, session-bound cookie follows PIN verification."""
import hashlib
import hmac
import secrets
from datetime import timedelta

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.models.conversation import ConversationMember
from app.security.jwt import create_access_token, decode_token


def hash_chat_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 240_000)
    return f"{salt.hex()}:{digest.hex()}"


def verify_chat_pin(pin: str, stored: str) -> bool:
    try:
        salt_hex, expected_hex = stored.split(":", 1)
        digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt_hex), 240_000)
        return hmac.compare_digest(digest, bytes.fromhex(expected_hex))
    except (ValueError, TypeError):
        return False


def lock_cookie_name(conversation_id: int) -> str:
    return f"relay_chat_unlock_{conversation_id}"


def is_chat_unlocked(request: Request | None, member: ConversationMember) -> bool:
    if not member.lock_pin_hash:
        return True
    if request is None:
        return False
    token = request.cookies.get(lock_cookie_name(member.conversation_id))
    return is_chat_unlocked_token(token, member, getattr(request.state, "session_id", None))


def is_chat_unlocked_token(token: str | None, member: ConversationMember, session_id: str | None) -> bool:
    if not member.lock_pin_hash:
        return True
    payload = decode_token(token) if token else None
    return bool(payload and payload.get("type") == "chat_unlock"
                and payload.get("sub") == str(member.user_id)
                and payload.get("conversation_id") == member.conversation_id
                and payload.get("session_id") == session_id
                and payload.get("version") == member.lock_version)


def require_chat_unlocked(request: Request, db: Session, user_id: int, conversation_id: int) -> ConversationMember:
    member = db.query(ConversationMember).filter_by(conversation_id=conversation_id, user_id=user_id).first()
    if not member:
        raise HTTPException(404, "Conversation not found")
    if not is_chat_unlocked(request, member):
        raise HTTPException(423, "Unlock this chat with its PIN")
    return member


def unlock_token(member: ConversationMember, session_id: str) -> str:
    return create_access_token({"type": "chat_unlock", "sub": str(member.user_id),
                                "conversation_id": member.conversation_id,
                                "session_id": session_id, "version": member.lock_version},
                               expires_delta=timedelta(minutes=15))
