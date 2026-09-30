import re
from fastapi import HTTPException, status
from app.config import settings

USERNAME_REGEX = re.compile(r"^[a-zA-Z0-9_]{3,30}$")
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$")


def validate_username(username: str) -> str:
    username = username.strip()
    if not USERNAME_REGEX.match(username):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username must be 3-30 characters long and contain only letters, numbers, and underscores."
        )
    return username.lower()


def validate_email(email: str) -> str:
    email = email.strip().lower()
    if not EMAIL_REGEX.match(email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email format."
        )
    return email


PHONE_REGEX = re.compile(r"^\+?[1-9]\d{6,14}$")


def validate_phone_number(phone: str) -> str:
    """Validate and clean phone number into normalized E.164-like string."""
    cleaned = re.sub(r"[\s\-\(\)]", "", phone.strip())
    if not PHONE_REGEX.match(cleaned):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid phone number format. Please provide a valid international or national phone number (e.g. +14155552671)."
        )
    return cleaned


def detect_identifier_type(identifier: str) -> str:
    """Determine whether identifier is email, phone, or username."""
    identifier = identifier.strip()
    if "@" in identifier:
        return "email"
    cleaned_phone = re.sub(r"[\s\-\(\)]", "", identifier)
    if cleaned_phone.startswith("+") or (cleaned_phone.isdigit() and len(cleaned_phone) >= 7):
        return "phone"
    return "username"


def validate_password(password: str) -> str:
    if len(password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters long."
        )
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password is too long (maximum 72 bytes)."
        )
    return password


def validate_file(filename: str, file_size: int) -> None:
    # Size check
    max_bytes = settings.MAX_FILE_SIZE_MB * 1024 * 1024
    if file_size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File exceeds maximum size limit of {settings.MAX_FILE_SIZE_MB}MB."
        )

    # Extension check
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File extension '.{ext}' is not supported. Allowed: {', '.join(settings.ALLOWED_EXTENSIONS)}"
        )
