import secrets
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from jose import jwt, JWTError
from app.config import settings


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Generate a signed short-lived JWT access token (~15 minutes)."""
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({
        "exp": expire,
        "iat": now,
        "nbf": now
    })
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def create_refresh_token() -> str:
    """Generate a cryptographically secure random refresh token string."""
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """Hash a refresh token or code using SHA-256 for secure server-side storage."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_2fa_ticket(user_id: int) -> str:
    """Generate a short-lived (5 min) temporary ticket for completing 2FA challenge."""
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=5)
    payload = {
        "sub": str(user_id),
        "type": "2fa_ticket",
        "exp": expire,
        "iat": now,
        "nbf": now
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and validate a JWT access token or 2FA ticket."""
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM]
        )
        return payload
    except JWTError:
        return None
