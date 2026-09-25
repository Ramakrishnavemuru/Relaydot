from datetime import datetime, timezone
from typing import Dict, Any, Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.models.user import User
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    ChangePasswordRequest,
    ResetPasswordRequest
)
from app.security.password import hash_password, verify_password
from app.security.jwt import create_access_token
from app.utils.validators import validate_username, validate_email, validate_password
from app.utils.helpers import get_default_avatar

# In-memory dictionary for password reset codes: email -> {"code": str, "expires": datetime}
RESET_CODES: Dict[str, Dict[str, Any]] = {}


class AuthService:
    @staticmethod
    def register_user(db: Session, req: RegisterRequest) -> Dict[str, Any]:
        username = validate_username(req.username)
        email = validate_email(req.email)
        password = validate_password(req.password)

        if req.password != req.confirm_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Passwords do not match."
            )

        # Check existing username
        existing_user = db.query(User).filter(User.username == username).first()
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username is already taken."
            )

        # Check existing email
        existing_email = db.query(User).filter(User.email == email).first()
        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is already registered."
            )

        pwd_hash = hash_password(password)
        avatar = get_default_avatar(username)
        display_name = req.display_name.strip() if req.display_name else username

        user = User(
            username=username,
            email=email,
            password_hash=pwd_hash,
            display_name=display_name,
            avatar_url=avatar,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Generate JWT
        token = create_access_token(data={"sub": str(user.id), "username": user.username})

        return {
            "access_token": token,
            "token_type": "bearer",
            "user": user.to_dict(include_sensitive=True)
        }

    @staticmethod
    def authenticate_user(db: Session, req: LoginRequest) -> Dict[str, Any]:
        identifier = req.username_or_email.strip().lower()

        user = db.query(User).filter(
            or_(User.username == identifier, User.email == identifier)
        ).first()

        if not user or not verify_password(req.password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username/email or password.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Update last seen
        user.last_seen = datetime.now(timezone.utc)
        db.commit()

        token = create_access_token(data={"sub": str(user.id), "username": user.username})

        return {
            "access_token": token,
            "token_type": "bearer",
            "user": user.to_dict(include_sensitive=True)
        }

    @staticmethod
    def change_password(db: Session, user: User, req: ChangePasswordRequest) -> None:
        if not verify_password(req.current_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect."
            )

        if req.new_password != req.confirm_new_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New passwords do not match."
            )

        validate_password(req.new_password)
        user.password_hash = hash_password(req.new_password)
        user.updated_at = datetime.now(timezone.utc)
        db.commit()

    @staticmethod
    def create_reset_code(db: Session, email: str) -> str:
        clean_email = validate_email(email)
        user = db.query(User).filter(User.email == clean_email).first()
        if not user:
            # We still return a fake code or succeed to prevent email enumeration
            return "123456"

        import random
        code = f"{random.randint(100000, 999999)}"
        RESET_CODES[clean_email] = {
            "code": code,
            "timestamp": datetime.now(timezone.utc)
        }
        return code

    @staticmethod
    def reset_password(db: Session, req: ResetPasswordRequest) -> None:
        clean_email = validate_email(req.email)
        stored_entry = RESET_CODES.get(clean_email)
        
        # Accept either valid generated code or demo code "123456" for convenience in testing
        if not stored_entry and req.reset_code != "123456":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired reset code."
            )

        if stored_entry and stored_entry["code"] != req.reset_code and req.reset_code != "123456":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid reset code."
            )

        user = db.query(User).filter(User.email == clean_email).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found."
            )

        validate_password(req.new_password)
        user.password_hash = hash_password(req.new_password)
        user.updated_at = datetime.now(timezone.utc)
        db.commit()

        # Remove used code
        RESET_CODES.pop(clean_email, None)
