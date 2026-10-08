import io
import json
import base64
import random
import secrets
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, List, Tuple

import pyotp
import qrcode
import qrcode.image.svg
import webauthn
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    ResidentKeyRequirement,
    UserVerificationRequirement,
    PublicKeyCredentialDescriptor,
    PublicKeyCredentialType
)
from fastapi import HTTPException, status, Request, Response
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc

from app.config import settings
from app.models.user import User
from app.models.session import UserSession
from app.models.otp import OTPVerification
from app.models.passkey import Passkey
from app.models.recovery_code import RecoveryCode
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    ChangePasswordRequest,
    ResetPasswordRequest,
    SendOTPRequest,
    VerifyOTPRequest,
    TwoFactorVerifyRequest
)
from app.security.password import hash_password, verify_password
from app.security.jwt import (
    create_access_token,
    create_refresh_token,
    hash_token,
    create_2fa_ticket,
    decode_token
)
from app.utils.validators import (
    validate_username,
    validate_email,
    validate_phone_number,
    validate_password,
    detect_identifier_type
)
from app.utils.helpers import get_default_avatar
from app.utils.device import parse_device_name, get_client_ip

# In-memory challenge stores with timestamp
WEBAUTHN_CHALLENGES: Dict[str, Dict[str, Any]] = {}
RESET_CODES: Dict[str, Dict[str, Any]] = {}
DEMO_CODE = "123456"


def demo_codes_enabled() -> bool:
    return settings.APP_ENV.lower() == "development"


def clean_expired_challenges():
    """Remove webauthn challenges older than 10 minutes."""
    now = datetime.now(timezone.utc)
    expired_keys = [
        k for k, v in WEBAUTHN_CHALLENGES.items()
        if (now - v.get("created_at", now)).total_seconds() > 600
    ]
    for k in expired_keys:
        WEBAUTHN_CHALLENGES.pop(k, None)


class AuthService:
    # -------------------------------------------------------------
    # Cookie & Session Helpers
    # -------------------------------------------------------------
    @staticmethod
    def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
        """Set access and refresh tokens in HttpOnly, SameSite cookies."""
        if not response:
            return
        response.set_cookie(
            key="access_token",
            value=access_token,
            httponly=True,
            max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            samesite=settings.COOKIE_SAMESITE,
            secure=settings.COOKIE_SECURE,
            path="/"
        )
        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
            samesite=settings.COOKIE_SAMESITE,
            secure=settings.COOKIE_SECURE,
            path="/"
        )

    @staticmethod
    def clear_auth_cookies(response: Response) -> None:
        """Remove auth cookies upon logout or session revocation."""
        if not response:
            return
        response.delete_cookie(key="access_token", path="/")
        response.delete_cookie(key="refresh_token", path="/")

    @staticmethod
    def create_user_session(
        db: Session,
        user: User,
        request: Request,
        response: Optional[Response] = None
    ) -> Tuple[UserSession, str, str]:
        """Create a new session record, rotate refresh token, set cookies, and return (session, access_token, refresh_token)."""
        user_agent = request.headers.get("user-agent", "")
        device_name = parse_device_name(user_agent)
        client_ip = get_client_ip(dict(request.headers), request.client.host if request.client else "127.0.0.1")

        refresh_token = create_refresh_token()
        refresh_token_hash = hash_token(refresh_token)

        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

        session = UserSession(
            user_id=user.id,
            device_name=device_name,
            ip_address=client_ip,
            user_agent=user_agent,
            refresh_token_hash=refresh_token_hash,
            created_at=now,
            last_active=now,
            expires_at=expires_at,
            revoked=False
        )
        db.add(session)
        user.last_seen = now
        db.commit()
        db.refresh(session)

        access_token = create_access_token(
            data={
                "sub": str(user.id),
                "username": user.username,
                "session_id": session.session_id
            }
        )

        if response:
            AuthService.set_auth_cookies(response, access_token, refresh_token)

        return session, access_token, refresh_token

    # -------------------------------------------------------------
    # Registration & OTP Verification
    # -------------------------------------------------------------
    @staticmethod
    def register_user(
        db: Session,
        req: RegisterRequest,
        request: Request,
        response: Optional[Response] = None
    ) -> Dict[str, Any]:
        """Register a new user account with email or phone number. Requires OTP confirmation before activation."""
        username = validate_username(req.username)

        email = None
        if req.email:
            email = validate_email(req.email)

        phone_number = None
        if req.phone_number:
            phone_number = validate_phone_number(req.phone_number)

        if not email and not phone_number:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Either email or phone number must be provided."
            )

        # Check existing username
        if db.query(User).filter(User.username == username).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username is already taken."
            )

        # Check existing email
        if email and db.query(User).filter(User.email == email).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email is already registered."
            )

        # Check existing phone
        if phone_number and db.query(User).filter(User.phone_number == phone_number).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Phone number is already registered."
            )

        # Optional password
        pwd_hash = None
        if req.password:
            if req.password != req.confirm_password:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Passwords do not match."
                )
            validate_password(req.password)
            pwd_hash = hash_password(req.password)

        avatar = get_default_avatar(username)
        display_name = req.display_name.strip() if req.display_name else username

        # Reserved example.com accounts are convenient for local demo data.
        is_verified = bool(demo_codes_enabled() and email and email.endswith("@example.com"))

        user = User(
            username=username,
            email=email,
            phone_number=phone_number,
            password_hash=pwd_hash,
            display_name=display_name,
            avatar_url=avatar,
            is_verified=is_verified,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        # Send OTP to primary identifier (email or phone)
        primary_identifier = email or phone_number
        otp_code = AuthService.generate_and_store_otp(db, primary_identifier, purpose="REGISTER")

        session, access_token, refresh_token = AuthService.create_user_session(db, user, request, response)

        return {
            "message": f"Account created. Verification code sent to {primary_identifier}.",
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "session_id": session.session_id,
            "user": user.to_dict(include_sensitive=True),
            "identifier": primary_identifier,
            "requires_otp": not user.is_verified,
            "demo_otp": otp_code if demo_codes_enabled() else None
        }

    @staticmethod
    def generate_and_store_otp(db: Session, identifier: str, purpose: str = "LOGIN") -> str:
        """Generate a secure 6-digit OTP and store its hash in the database."""
        clean_identifier = identifier.strip().lower() if "@" in identifier else validate_phone_number(identifier)

        # Invalidate previous unused codes for this identifier and purpose
        db.query(OTPVerification).filter(
            OTPVerification.identifier == clean_identifier,
            OTPVerification.purpose == purpose,
            OTPVerification.is_used == False
        ).update({"is_used": True})

        otp_code = DEMO_CODE if demo_codes_enabled() else f"{secrets.randbelow(900000) + 100000}"
        code_hash = hash_token(otp_code)
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)

        otp_entry = OTPVerification(
            identifier=clean_identifier,
            otp_code_hash=code_hash,
            purpose=purpose,
            created_at=now,
            expires_at=expires_at,
            is_used=False,
            attempts=0
        )
        db.add(otp_entry)
        db.commit()
        return otp_code

    @staticmethod
    def send_otp(db: Session, req: SendOTPRequest) -> Dict[str, Any]:
        """Send OTP to email or phone number for registration, login, or verification."""
        id_type = detect_identifier_type(req.identifier)
        clean_id = validate_email(req.identifier) if id_type == "email" else validate_phone_number(req.identifier)

        # If purpose is LOGIN, ensure user actually exists
        if req.purpose == "LOGIN":
            user = db.query(User).filter(
                or_(User.email == clean_id, User.phone_number == clean_id)
            ).first()
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No account found associated with this email or phone number."
                )

        otp_code = AuthService.generate_and_store_otp(db, clean_id, purpose=req.purpose)

        return {
            "message": f"Verification code sent to {clean_id}.",
            "identifier": clean_id,
            "purpose": req.purpose,
            "demo_otp": otp_code if demo_codes_enabled() else None
        }

    @staticmethod
    def verify_otp(
        db: Session,
        req: VerifyOTPRequest,
        request: Request,
        response: Optional[Response] = None
    ) -> Dict[str, Any]:
        """Verify OTP. If registering, marks account verified. If logging in, issues tokens and creates session."""
        id_type = detect_identifier_type(req.identifier)
        clean_id = validate_email(req.identifier) if id_type == "email" else validate_phone_number(req.identifier)

        now = datetime.now(timezone.utc)
        otp_entry = db.query(OTPVerification).filter(
            OTPVerification.identifier == clean_id,
            OTPVerification.purpose == req.purpose,
            OTPVerification.is_used == False,
            OTPVerification.expires_at > now
        ).order_by(desc(OTPVerification.created_at)).first()

        code_matches = False
        if otp_entry:
            otp_entry.attempts += 1
            if hash_token(req.otp_code.strip()) == otp_entry.otp_code_hash:
                code_matches = True
                otp_entry.is_used = True
            db.commit()

        if not code_matches:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired verification code."
            )

        # Find user
        user = db.query(User).filter(
            or_(User.email == clean_id, User.phone_number == clean_id)
        ).first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User account not found."
            )

        # Mark user as verified
        user.is_verified = True
        db.commit()

        # If user has 2FA enabled, issue 2FA challenge ticket
        if user.totp_enabled:
            ticket = create_2fa_ticket(user.id)
            return {
                "requires_2fa": True,
                "ticket": ticket,
                "methods": ["totp", "recovery_code", "passkey"],
                "message": "Two-factor authentication required.",
                "demo_code": DEMO_CODE if demo_codes_enabled() else None
            }

        # Create session and issue tokens
        session, access_token, refresh_token = AuthService.create_user_session(db, user, request, response)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "session_id": session.session_id,
            "user": user.to_dict(include_sensitive=True),
            "requires_2fa": False
        }

    # -------------------------------------------------------------
    # Password & Identifier Authentication
    # -------------------------------------------------------------
    @staticmethod
    def authenticate_user(
        db: Session,
        req: LoginRequest,
        request: Request,
        response: Optional[Response] = None
    ) -> Dict[str, Any]:
        """Authenticate with username/email/phone and password."""
        raw_id = (req.username_or_email or req.identifier or "").strip().lower()
        if not raw_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username, email, or phone number required."
            )

        # Find user by username, email, or phone
        user = db.query(User).filter(
            or_(
                User.username == raw_id,
                User.email == raw_id,
                User.phone_number == raw_id
            )
        ).first()

        if not user or not user.password_hash or not verify_password(req.password or "", user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Check verified status
        if not user.is_verified:
            # Trigger an OTP send so they can activate immediately
            primary_id = user.email or user.phone_number or user.username
            otp_code = AuthService.generate_and_store_otp(db, primary_id, purpose="REGISTER")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Account is not verified. A verification code has been generated for {primary_id}." + (f" (Demo code: {otp_code})" if demo_codes_enabled() else "")
            )

        # Check 2FA
        if user.totp_enabled:
            ticket = create_2fa_ticket(user.id)
            return {
                "requires_2fa": True,
                "ticket": ticket,
                "methods": ["totp", "recovery_code", "passkey"],
                "message": "Two-factor authentication required.",
                "demo_code": DEMO_CODE if demo_codes_enabled() else None
            }

        session, access_token, refresh_token = AuthService.create_user_session(db, user, request, response)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "session_id": session.session_id,
            "user": user.to_dict(include_sensitive=True),
            "requires_2fa": False
        }

    # -------------------------------------------------------------
    # 2FA Verification (TOTP or Recovery Code)
    # -------------------------------------------------------------
    @staticmethod
    def verify_2fa(
        db: Session,
        req: TwoFactorVerifyRequest,
        request: Request,
        response: Optional[Response] = None
    ) -> Dict[str, Any]:
        """Verify 2FA ticket using a 6-digit TOTP code or backup recovery code."""
        payload = decode_token(req.ticket)
        if not payload or payload.get("type") != "2fa_ticket":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired 2FA session ticket. Please log in again."
            )

        user_id = int(payload.get("sub"))
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

        code_input = req.code.strip()
        verified = False

        # 1. Try TOTP code
        if user.totp_secret and len(code_input) == 6 and code_input.isdigit():
            totp = pyotp.TOTP(user.totp_secret)
            if totp.verify(code_input, valid_window=1) or (demo_codes_enabled() and code_input == DEMO_CODE):
                verified = True

        # 2. Try Recovery Code if not verified by TOTP
        if not verified:
            input_hash = hash_token(code_input.upper())
            recovery_entry = db.query(RecoveryCode).filter(
                RecoveryCode.user_id == user.id,
                RecoveryCode.code_hash == input_hash,
                RecoveryCode.used == False
            ).first()

            if recovery_entry:
                recovery_entry.used = True
                recovery_entry.used_at = datetime.now(timezone.utc)
                db.commit()
                verified = True

        if not verified:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid authenticator code or recovery code."
            )

        # Successful 2FA: Create session and issue tokens
        session, access_token, refresh_token = AuthService.create_user_session(db, user, request, response)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "session_id": session.session_id,
            "user": user.to_dict(include_sensitive=True),
            "requires_2fa": False
        }

    # -------------------------------------------------------------
    # Token Rotation & Refresh
    # -------------------------------------------------------------
    @staticmethod
    def rotate_refresh_token(
        db: Session,
        refresh_token_input: Optional[str],
        request: Request,
        response: Optional[Response] = None
    ) -> Dict[str, Any]:
        """Rotate long-lived refresh token and issue new short-lived access token."""
        token_str = refresh_token_input or request.cookies.get("refresh_token")
        if not token_str:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token required.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        token_hash = hash_token(token_str)
        session = db.query(UserSession).filter(
            UserSession.refresh_token_hash == token_hash
        ).first()

        if not session or session.revoked:
            if response:
                AuthService.clear_auth_cookies(response)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session is invalid or has been revoked.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        now = datetime.now(timezone.utc)
        expires_at = session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            session.revoked = True
            session.revoked_at = now
            db.commit()
            if response:
                AuthService.clear_auth_cookies(response)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session has expired. Please log in again.",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user = db.query(User).filter(User.id == session.user_id).first()
        if not user or not user.is_verified:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not active.")

        # Rotate refresh token
        new_refresh_token = create_refresh_token()
        session.refresh_token_hash = hash_token(new_refresh_token)
        session.last_active = now
        session.expires_at = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
        db.commit()

        new_access_token = create_access_token(
            data={
                "sub": str(user.id),
                "username": user.username,
                "session_id": session.session_id
            }
        )

        if response:
            AuthService.set_auth_cookies(response, new_access_token, new_refresh_token)

        return {
            "access_token": new_access_token,
            "refresh_token": new_refresh_token,
            "token_type": "bearer",
            "session_id": session.session_id,
            "user": user.to_dict(include_sensitive=True)
        }

    # -------------------------------------------------------------
    # Device & Session Management
    # -------------------------------------------------------------
    @staticmethod
    def list_sessions(db: Session, user_id: int, current_session_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """List active unrevoked sessions for the current user."""
        now = datetime.now(timezone.utc)
        sessions = db.query(UserSession).filter(
            UserSession.user_id == user_id,
            UserSession.revoked == False,
            UserSession.expires_at > now
        ).order_by(desc(UserSession.last_active)).all()

        return [s.to_dict(current_session_id=current_session_id) for s in sessions]

    @staticmethod
    def revoke_session(
        db: Session,
        user_id: int,
        session_id: str,
        current_session_id: Optional[str] = None,
        response: Optional[Response] = None
    ) -> None:
        """Revoke a specific session (device logout)."""
        session = db.query(UserSession).filter(
            UserSession.user_id == user_id,
            UserSession.session_id == session_id
        ).first()

        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found.")

        session.revoked = True
        session.revoked_at = datetime.now(timezone.utc)
        db.commit()

        if current_session_id and session_id == current_session_id and response:
            AuthService.clear_auth_cookies(response)

    @staticmethod
    def revoke_other_sessions(
        db: Session,
        user_id: int,
        current_session_id: Optional[str]
    ) -> int:
        """Revoke all active sessions for user except current device."""
        now = datetime.now(timezone.utc)
        query = db.query(UserSession).filter(
            UserSession.user_id == user_id,
            UserSession.revoked == False
        )
        if current_session_id:
            query = query.filter(UserSession.session_id != current_session_id)

        count = query.update({"revoked": True, "revoked_at": now})
        db.commit()
        return count

    # -------------------------------------------------------------
    # 2FA Management (TOTP Setup, Enable, Disable)
    # -------------------------------------------------------------
    @staticmethod
    def setup_totp(user: User) -> Dict[str, Any]:
        """Generate a new TOTP secret and SVG QR code for authenticator app configuration."""
        secret = pyotp.random_base32()
        app_name = settings.APP_NAME.replace(" ", "")
        totp = pyotp.TOTP(secret)
        otpauth_url = totp.provisioning_uri(
            name=user.email or user.phone_number or user.username,
            issuer_name=app_name
        )

        # Generate SVG QR Code
        factory = qrcode.image.svg.SvgPathImage
        img = qrcode.make(otpauth_url, image_factory=factory)
        buf = io.BytesIO()
        img.save(buf)
        svg_str = buf.getvalue().decode("utf-8")
        qr_data_url = f"data:image/svg+xml;utf8,{svg_str}"

        # Temporarily save secret
        WEBAUTHN_CHALLENGES[f"totp_setup_{user.id}"] = {
            "secret": secret,
            "created_at": datetime.now(timezone.utc)
        }

        return {
            "secret": secret,
            "otpauth_url": otpauth_url,
            "qr_code": qr_data_url
        }

    @staticmethod
    def enable_totp(db: Session, user: User, code: str) -> List[str]:
        """Verify code from authenticator app, enable 2FA, and generate backup recovery codes."""
        stored = WEBAUTHN_CHALLENGES.get(f"totp_setup_{user.id}")
        if not stored:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Please initiate TOTP setup first."
            )

        secret = stored["secret"]
        totp = pyotp.TOTP(secret)
        if not totp.verify(code.strip(), valid_window=1) and not (demo_codes_enabled() and code.strip() == DEMO_CODE):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid code from authenticator app."
            )

        user.totp_secret = secret
        user.totp_enabled = True

        # Generate 8 single-use recovery codes
        db.query(RecoveryCode).filter(RecoveryCode.user_id == user.id).delete()
        plain_codes = []
        now = datetime.now(timezone.utc)

        for _ in range(8):
            part1 = f"{random.randint(1000, 9999)}"
            part2 = f"{random.randint(1000, 9999)}"
            plain_code = f"{part1}-{part2}"
            plain_codes.append(plain_code)

            rc = RecoveryCode(
                user_id=user.id,
                code_hash=hash_token(plain_code),
                used=False,
                created_at=now
            )
            db.add(rc)

        db.commit()
        WEBAUTHN_CHALLENGES.pop(f"totp_setup_{user.id}", None)
        return plain_codes

    @staticmethod
    def disable_totp(
        db: Session,
        user: User,
        code: Optional[str] = None,
        password: Optional[str] = None
    ) -> None:
        """Disable 2FA after checking password or current TOTP code."""
        verified = False
        if password and user.password_hash and verify_password(password, user.password_hash):
            verified = True
        elif code and user.totp_secret:
            totp = pyotp.TOTP(user.totp_secret)
            if totp.verify(code.strip(), valid_window=1) or (demo_codes_enabled() and code.strip() == DEMO_CODE):
                verified = True

        if not verified:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid password or authenticator code to disable 2FA."
            )

        user.totp_enabled = False
        user.totp_secret = None
        db.query(RecoveryCode).filter(RecoveryCode.user_id == user.id).delete()
        db.commit()

    # -------------------------------------------------------------
    # Passkeys (WebAuthn)
    # -------------------------------------------------------------
    @staticmethod
    def get_passkey_register_options(user: User) -> Dict[str, Any]:
        """Generate WebAuthn registration options for creating a passkey."""
        clean_expired_challenges()
        opts = webauthn.generate_registration_options(
            rp_id=settings.RP_ID,
            rp_name=settings.RP_NAME,
            user_id=str(user.id).encode("utf-8"),
            user_name=user.username,
            user_display_name=user.display_name or user.username,
            attestation=webauthn.helpers.structs.AttestationConveyancePreference.NONE,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED,
                user_verification=UserVerificationRequirement.PREFERRED
            )
        )
        challenge_key = f"reg_{user.id}"
        WEBAUTHN_CHALLENGES[challenge_key] = {
            "challenge": opts.challenge,
            "created_at": datetime.now(timezone.utc)
        }
        return json.loads(webauthn.options_to_json(opts))

    @staticmethod
    def verify_passkey_register(
        db: Session,
        user: User,
        name: str,
        response_data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Verify WebAuthn credential registration response and store passkey."""
        challenge_key = f"reg_{user.id}"
        stored = WEBAUTHN_CHALLENGES.get(challenge_key)
        if not stored:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Passkey registration challenge expired or not found."
            )

        expected_challenge = stored["challenge"]
        allowed_origins = [settings.RP_ORIGIN] + settings.ALLOWED_ORIGINS

        try:
            verification = webauthn.verify_registration_response(
                credential=response_data,
                expected_challenge=expected_challenge,
                expected_rp_id=settings.RP_ID,
                expected_origin=allowed_origins,
                require_user_verification=False
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Passkey registration failed: {str(e)}"
            )

        credential_id_str = bytes_to_base64url(verification.credential_id)
        public_key_str = bytes_to_base64url(verification.credential_public_key)

        passkey = Passkey(
            user_id=user.id,
            credential_id=credential_id_str,
            public_key=public_key_str,
            sign_count=verification.sign_count,
            name=name.strip() or "My Passkey",
            aaguid=verification.aaguid,
            created_at=datetime.now(timezone.utc)
        )
        db.add(passkey)
        db.commit()
        db.refresh(passkey)
        WEBAUTHN_CHALLENGES.pop(challenge_key, None)

        return passkey.to_dict()

    @staticmethod
    def get_passkey_login_options(db: Session, identifier: Optional[str] = None) -> Dict[str, Any]:
        """Generate WebAuthn authentication options for passkey login."""
        clean_expired_challenges()
        allowed_credentials = None

        if identifier:
            user = db.query(User).filter(
                or_(
                    User.username == identifier.strip().lower(),
                    User.email == identifier.strip().lower(),
                    User.phone_number == identifier.strip()
                )
            ).first()
            if user:
                user_passkeys = db.query(Passkey).filter(Passkey.user_id == user.id).all()
                if user_passkeys:
                    allowed_credentials = [
                        PublicKeyCredentialDescriptor(
                            id=base64url_to_bytes(p.credential_id),
                            type=PublicKeyCredentialType.PUBLIC_KEY
                        )
                        for p in user_passkeys
                    ]

        opts = webauthn.generate_authentication_options(
            rp_id=settings.RP_ID,
            allow_credentials=allowed_credentials,
            user_verification=UserVerificationRequirement.PREFERRED
        )

        challenge_id = bytes_to_base64url(opts.challenge)
        WEBAUTHN_CHALLENGES[challenge_id] = {
            "challenge": opts.challenge,
            "purpose": "passkey_login",
            "created_at": datetime.now(timezone.utc)
        }

        opts_json = json.loads(webauthn.options_to_json(opts))
        opts_json["challenge_id"] = challenge_id
        return opts_json

    @staticmethod
    def verify_passkey_login(
        db: Session,
        response_data: Dict[str, Any],
        challenge_id: str,
        request: Request,
        response: Optional[Response] = None
    ) -> Dict[str, Any]:
        """Verify WebAuthn authentication assertion and log user in passwordlessly."""
        raw_cred_id = response_data.get("id") or response_data.get("rawId")
        if not raw_cred_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Credential ID missing.")

        passkey = db.query(Passkey).filter(Passkey.credential_id == raw_cred_id).first()
        if not passkey:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passkey not recognized.")

        user = db.query(User).filter(User.id == passkey.user_id).first()
        if not user or not user.is_verified:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User account inactive.")

        clean_expired_challenges()
        challenge_entry = WEBAUTHN_CHALLENGES.get(challenge_id)
        if not challenge_entry or challenge_entry.get("purpose") != "passkey_login":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Authentication challenge expired.")

        allowed_origins = [settings.RP_ORIGIN] + settings.ALLOWED_ORIGINS
        try:
            verification = webauthn.verify_authentication_response(
                credential=response_data,
                expected_challenge=challenge_entry["challenge"],
                expected_rp_id=settings.RP_ID,
                expected_origin=allowed_origins,
                credential_public_key=base64url_to_bytes(passkey.public_key),
                credential_current_sign_count=passkey.sign_count,
                require_user_verification=False
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Passkey verification failed: {str(e)}"
            )

        passkey.sign_count = verification.new_sign_count
        passkey.last_used_at = datetime.now(timezone.utc)
        db.commit()
        WEBAUTHN_CHALLENGES.pop(challenge_id, None)

        session, access_token, refresh_token = AuthService.create_user_session(db, user, request, response)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "session_id": session.session_id,
            "user": user.to_dict(include_sensitive=True),
            "requires_2fa": False
        }

    @staticmethod
    def list_passkeys(db: Session, user_id: int) -> List[Dict[str, Any]]:
        """List registered passkeys for current user."""
        keys = db.query(Passkey).filter(Passkey.user_id == user_id).order_by(desc(Passkey.created_at)).all()
        return [k.to_dict() for k in keys]

    @staticmethod
    def delete_passkey(db: Session, user_id: int, passkey_id: int) -> None:
        """Delete a registered passkey."""
        key = db.query(Passkey).filter(Passkey.id == passkey_id, Passkey.user_id == user_id).first()
        if not key:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passkey not found.")
        db.delete(key)
        db.commit()

    # -------------------------------------------------------------
    # Password Reset & Change
    # -------------------------------------------------------------
    @staticmethod
    def change_password(db: Session, user: User, req: ChangePasswordRequest) -> None:
        if user.password_hash and not verify_password(req.current_password, user.password_hash):
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
            return DEMO_CODE if demo_codes_enabled() else ""

        code = DEMO_CODE if demo_codes_enabled() else f"{secrets.randbelow(900000) + 100000}"
        RESET_CODES[clean_email] = {
            "code": code,
            "timestamp": datetime.now(timezone.utc)
        }
        return code

    @staticmethod
    def reset_password(db: Session, req: ResetPasswordRequest) -> None:
        clean_email = validate_email(req.email)
        stored_entry = RESET_CODES.get(clean_email)

        if not stored_entry or (datetime.now(timezone.utc) - stored_entry["timestamp"]).total_seconds() > settings.OTP_EXPIRE_MINUTES * 60:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired reset code."
            )

        if stored_entry["code"] != req.reset_code:
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
        RESET_CODES.pop(clean_email, None)
