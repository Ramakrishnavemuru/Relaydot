"""Email plus enrolled TOTP recovery for an existing staff account."""
import logging
import os
import secrets
import smtplib
import ssl
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib.parse import urlsplit

import pyotp
from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import settings
from app.models.session import UserSession
from app.models.staff import ModeratorAuditLog, StaffPasswordReset
from app.models.user import User
from app.security.jwt import hash_token
from app.security.password import hash_password, verify_password
from app.utils.validators import validate_password

logger = logging.getLogger(__name__)
GENERIC_RESPONSE = "If an eligible account exists for this email, password reset instructions will be sent."
RESET_TTL = timedelta(minutes=15)
INVALID_RESET = "Invalid or expired recovery link or authenticator code. Request a new link if needed."


def configured_origin() -> str:
    """Use only a configured origin; never trust the request Host header for email links."""
    origin = settings.STAFF_RECOVERY_ORIGIN.rstrip("/")
    parsed = urlsplit(origin)
    local = (parsed.hostname == "localhost" and settings.APP_ENV.lower() != "production"
             and not os.environ.get("RENDER") and not os.environ.get("RENDER_EXTERNAL_HOSTNAME"))
    if (parsed.scheme != "https" and not (local and parsed.scheme == "http")) or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise RuntimeError("STAFF_RECOVERY_ORIGIN must be a trusted HTTPS origin (localhost HTTP is allowed for development)")
    return origin


def mail_ready() -> bool:
    try:
        configured_origin()
    except RuntimeError:
        return False
    return bool(settings.SMTP_HOST and settings.SMTP_FROM_EMAIL and
                (bool(settings.SMTP_USERNAME) == bool(settings.SMTP_PASSWORD)))


def _send_email(recipient: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = settings.SMTP_FROM_EMAIL
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    context = ssl.create_default_context()
    if settings.SMTP_USE_SSL:
        with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10, context=context) as smtp:
            if settings.SMTP_USERNAME:
                smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as smtp:
            smtp.starttls(context=context)
            if settings.SMTP_USERNAME:
                smtp.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            smtp.send_message(message)


def _safe_send(recipient: str, subject: str, body: str) -> None:
    try:
        _send_email(recipient, subject, body)
    except Exception:
        # Never log the message body: a recovery email contains the one-time token.
        logger.error("Staff recovery email delivery failed")


def eligible(user: User | None) -> bool:
    return bool(user and user.role in {"MODERATOR", "OWNER"} and user.is_verified and
                user.totp_enabled and user.totp_secret and user.email)


def issue_reset_link(db: Session, email: str) -> tuple[str, str] | None:
    """Invalidate earlier links and return a delivery task for an eligible account."""
    started = time.monotonic()
    token = secrets.token_urlsafe(48)
    token_hash = hash_token(token)
    user = db.query(User).filter(User.email == email.strip().lower()).first()
    delivery = None
    if eligible(user):
        now = datetime.now(timezone.utc)
        db.query(StaffPasswordReset).filter_by(user_id=user.id, consumed_at=None).update(
            {"consumed_at": now}, synchronize_session=False)
        db.add(StaffPasswordReset(user_id=user.id, token_hash=token_hash,
                                  created_at=now, expires_at=now + RESET_TTL))
        db.commit()
        link = f"{configured_origin()}/app/staff/reset-password#token={token}"
        delivery = (user.email, link)
    # SMTP runs after the response. A small floor reduces database timing differences.
    remaining = 0.15 - (time.monotonic() - started)
    if remaining > 0:
        time.sleep(remaining)
    return delivery


def _totp_step(user: User, code: str, now: datetime) -> int | None:
    if not code.isdigit() or len(code) != 6 or not user.totp_secret:
        return None
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(code, for_time=now, valid_window=1):
        return None
    current = int(now.timestamp()) // totp.interval
    for step in (current - 1, current, current + 1):
        if secrets.compare_digest(totp.at(step * totp.interval), code):
            return step
    return None


def reset_staff_password(db: Session, token: str, code: str,
                         password: str, confirmation: str) -> tuple[int, str]:
    now = datetime.now(timezone.utc)
    row = db.query(StaffPasswordReset).filter_by(token_hash=hash_token(token)).with_for_update().first()
    if not row or row.consumed_at or row.attempts >= 5 or row.expires_at.replace(tzinfo=timezone.utc) <= now:
        raise HTTPException(400, INVALID_RESET)
    user = db.get(User, row.user_id)
    if not eligible(user):
        raise HTTPException(400, INVALID_RESET)
    if password != confirmation:
        raise HTTPException(400, "New passwords do not match.")
    validate_password(password)
    if len(password) < 12 or not password.strip():
        raise HTTPException(400, "Choose a password of at least 12 characters.")
    if user.password_hash and verify_password(password, user.password_hash):
        raise HTTPException(400, "Choose a password you have not used for this account.")

    step = _totp_step(user, code, now)
    if step is None or (user.staff_recovery_totp_step is not None and step <= user.staff_recovery_totp_step):
        row.attempts += 1
        if row.attempts >= 5:
            row.consumed_at = now
        db.commit()
        raise HTTPException(400, INVALID_RESET)

    updated = db.query(User).filter(User.id == user.id,
        or_(User.staff_recovery_totp_step.is_(None), User.staff_recovery_totp_step < step)).update(
            {"staff_recovery_totp_step": step}, synchronize_session=False)
    consumed = db.query(StaffPasswordReset).filter(StaffPasswordReset.id == row.id,
        StaffPasswordReset.consumed_at.is_(None), StaffPasswordReset.attempts < 5,
        StaffPasswordReset.expires_at > now).update({"consumed_at": now}, synchronize_session=False)
    if updated != 1 or consumed != 1:
        db.rollback()
        raise HTTPException(400, INVALID_RESET)

    user.password_hash = hash_password(password)
    user.updated_at = now
    db.query(StaffPasswordReset).filter(StaffPasswordReset.user_id == user.id,
        StaffPasswordReset.consumed_at.is_(None)).update({"consumed_at": now}, synchronize_session=False)
    db.query(UserSession).filter(UserSession.user_id == user.id,
        UserSession.revoked.is_(False)).update({"revoked": True, "revoked_at": now,
                                               "staff_verified_until": None}, synchronize_session=False)
    from app.models.security_event import record_security_event
    record_security_event(db, user.id, "PASSWORD_CHANGED", "Password changed through staff recovery; all sessions revoked.")
    db.add(ModeratorAuditLog(actor_id=user.id, action="STAFF_PASSWORD_RECOVERY",
                             target_type="user", target_id=user.id,
                             reason="Registered email link and enrolled TOTP verified", result="SUCCESS"))
    db.commit()
    return user.id, user.email


def queue_reset_email(background_tasks, recipient: str, link: str) -> None:
    background_tasks.add_task(_safe_send, recipient, "Relaydot staff password recovery",
        "A password reset was requested for your Relaydot staff account.\n\n"
        f"Open this link within 15 minutes: {link}\n\n"
        "You will also need the current code from your authenticator app. "
        "If you did not request this, you can ignore this email.")


def queue_changed_notice(background_tasks, recipient: str) -> None:
    background_tasks.add_task(_safe_send, recipient, "Relaydot staff password changed",
        "The password for your Relaydot staff account was changed. "
        "All existing sessions were signed out. If this was not you, contact your administrator immediately.")
