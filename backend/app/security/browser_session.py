"""Opaque browser sessions backed by the existing revocable session records."""
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from app.config import settings
from app.models.session import UserSession
from app.security.jwt import hash_token


def cookie_name():
    return "__Host-relaydot_session" if settings.COOKIE_SECURE else "relaydot_session"


def csrf_token(session):
    return hmac.new(settings.SECRET_KEY.encode(),
                    ("csrf:" + session.refresh_token_hash).encode(), hashlib.sha256).hexdigest()


def valid_session(session):
    if not session or session.revoked:
        return False
    now = datetime.now(timezone.utc)
    aware = lambda dt: dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    return (aware(session.expires_at) > now
            and aware(session.created_at) + timedelta(hours=settings.SESSION_ABSOLUTE_HOURS) > now
            and aware(session.last_active) + timedelta(minutes=settings.SESSION_IDLE_MINUTES) > now)


def resolve_cookie(db, cookies):
    raw = cookies.get(cookie_name())
    if raw:
        session = db.query(UserSession).filter_by(refresh_token_hash=hash_token(raw)).first()
    elif cookies.get("refresh_token"):
        session = db.query(UserSession).filter_by(refresh_token_hash=hash_token(cookies["refresh_token"])).first()
    elif cookies.get("access_token"):
        from app.security.jwt import decode_token
        payload = decode_token(cookies["access_token"])
        try:
            session = db.query(UserSession).filter_by(session_id=payload.get("session_id"), user_id=int(payload["sub"])).first() if payload and payload.get("session_id") else None
        except (ValueError, TypeError, KeyError):
            session = None
    else:
        return None
    if not valid_session(session):
        raise HTTPException(401, "Session has expired. Please sign in again.")
    return session
