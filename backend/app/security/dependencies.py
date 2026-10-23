from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from fastapi import Depends, HTTPException, status, Query, WebSocket, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.user import User
from app.models.session import UserSession
from app.security.jwt import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def extract_token_from_request(request: Request, bearer_token: Optional[str]) -> Optional[str]:
    """Extract access token from Bearer header or HttpOnly cookie."""
    if bearer_token:
        return bearer_token
    # Check HttpOnly cookie
    cookie_token = request.cookies.get("access_token")
    if cookie_token:
        return cookie_token
    return None


def get_current_user(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """Dependency to retrieve the authenticated user from a Bearer token or HttpOnly cookie."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    raw_token = extract_token_from_request(request, token)
    if not raw_token:
        raise credentials_exception

    payload = decode_token(raw_token)
    if payload is None:
        raise credentials_exception

    # Reject temporary 2FA challenge tickets
    if payload.get("type") == "2fa_ticket" or not payload.get("session_id"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Two-factor authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id_str = payload.get("sub")
    if user_id_str is None:
        raise credentials_exception

    try:
        user_id = int(user_id_str)
    except (ValueError, TypeError):
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    if user.account_state == "BANNED" and not request.url.path.startswith(("/api/support/appeals", "/api/support/actions", "/api/auth/me", "/api/auth/logout")):
        raise HTTPException(status_code=403, detail="Account unavailable.")
    if user.account_state == "RESTRICTED":
        until = user.restricted_until.replace(tzinfo=timezone.utc) if user.restricted_until else None
        if until and until <= datetime.now(timezone.utc):
            user.account_state = "ACTIVE"
            user.restricted_until = None
            db.commit()
        elif request.method not in {"GET", "HEAD", "OPTIONS"} and request.url.path.startswith((
                "/api/social", "/api/messages", "/api/stories", "/api/reels", "/api/conversations", "/api/groups", "/api/calls")):
            raise HTTPException(status_code=403, detail="Posting is temporarily restricted for this account.")

    # Check if session is tracked and still valid
    session_id = payload.get("session_id")
    if session_id:
        user_session = db.query(UserSession).filter(UserSession.session_id == session_id).first()
        if not user_session or user_session.user_id != user.id or user_session.revoked:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has been revoked or expired.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        now = datetime.now(timezone.utc)
        expires_at = user_session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has expired. Please log in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Throttled update of last_active
        last_act = user_session.last_active
        if last_act.tzinfo is None:
            last_act = last_act.replace(tzinfo=timezone.utc)
        if (now - last_act).total_seconds() > 60:
            user_session.last_active = now
            db.commit()

        request.state.session_id = session_id

    # Check email / phone verification
    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not verified. Please complete OTP verification."
        )

    return user


def get_staff_user(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    if user.role not in {"MODERATOR", "OWNER"}:
        raise HTTPException(status_code=403, detail="Staff access required.")
    session_id = getattr(request.state, "session_id", None)
    session = db.query(UserSession).filter_by(session_id=session_id, user_id=user.id, revoked=False).first() if session_id else None
    if not user.totp_enabled or not session or not session.staff_verified_until:
        raise HTTPException(status_code=403, detail="Staff MFA required.")
    expires = session.staff_verified_until.replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        raise HTTPException(status_code=403, detail="Staff authentication expired. Sign in again.")
    return user


def get_owner_user(user: User = Depends(get_staff_user)) -> User:
    if user.role != "OWNER":
        raise HTTPException(status_code=403, detail="Owner access required.")
    return user


def get_recent_owner(request: Request, user: User = Depends(get_owner_user), db: Session = Depends(get_db)) -> User:
    session = db.query(UserSession).filter_by(session_id=getattr(request.state, "session_id", None), user_id=user.id).first()
    created = session.created_at.replace(tzinfo=timezone.utc) if session else None
    if not created or datetime.now(timezone.utc) - created > timedelta(minutes=5):
        raise HTTPException(status_code=403, detail="Sign in again with MFA for this sensitive action.")
    return user


def get_current_user_optional(
    request: Request,
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """Dependency for optional authentication."""
    try:
        return get_current_user(request=request, token=token, db=db)
    except HTTPException:
        return None


def get_current_user_ws(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """Validate JWT token passed in WebSocket query parameters, headers, or cookies."""
    if not token:
        # Check Authorization header if present
        auth_header = websocket.headers.get("authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]

    if not token:
        # Check cookies
        token = websocket.cookies.get("access_token")

    if not token:
        return None

    payload = decode_token(token)
    if not payload:
        return None

    if payload.get("type") == "2fa_ticket":
        return None

    user_id_str = payload.get("sub")
    if not user_id_str:
        return None

    try:
        user_id = int(user_id_str)
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_verified or user.account_state == "BANNED":
            return None

        # Check session validity
        session_id = payload.get("session_id")
        if not session_id:
            return None
        user_session = db.query(UserSession).filter(UserSession.session_id == session_id,
                                                    UserSession.user_id == user.id).first()
        if not user_session or user_session.revoked or user_session.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
            return None

        return user
    except Exception:
        return None
