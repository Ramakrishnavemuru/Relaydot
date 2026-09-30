from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, status, Request, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.auth import (
    RegisterRequest,
    LoginRequest,
    TokenResponse,
    RefreshTokenRequest,
    SendOTPRequest,
    VerifyOTPRequest,
    TwoFactorVerifyRequest,
    TOTPEnableRequest,
    TOTPDisableRequest,
    PasskeyRegisterVerifyRequest,
    PasskeyLoginVerifyRequest,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest
)
from app.schemas.user import UserResponse
from app.services.auth_service import AuthService
from app.security.dependencies import get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])


# -------------------------------------------------------------
# Registration & Login
# -------------------------------------------------------------
@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(
    req: RegisterRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """Register account with email or phone number. Requires OTP confirmation before full active login."""
    return AuthService.register_user(db, req, request, response)


@router.post("/login", response_model=TokenResponse)
def login(
    req: LoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """Authenticate with username, email, or phone and password. Triggers 2FA challenge if enabled."""
    return AuthService.authenticate_user(db, req, request, response)


@router.post("/otp/send")
def send_otp(req: SendOTPRequest, db: Session = Depends(get_db)):
    """Request an OTP verification code sent to email or phone."""
    return AuthService.send_otp(db, req)


@router.post("/otp/verify", response_model=TokenResponse)
def verify_otp(
    req: VerifyOTPRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """Verify OTP code. Activates unverified accounts or completes passwordless login."""
    return AuthService.verify_otp(db, req, request, response)


# -------------------------------------------------------------
# 2FA Verification
# -------------------------------------------------------------
@router.post("/2fa/verify", response_model=TokenResponse)
def verify_2fa(
    req: TwoFactorVerifyRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """Verify 2FA challenge using an authenticator app code or backup recovery code."""
    return AuthService.verify_2fa(db, req, request, response)


# -------------------------------------------------------------
# Token Rotation & Refresh
# -------------------------------------------------------------
@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    request: Request,
    response: Response,
    req: Optional[RefreshTokenRequest] = None,
    db: Session = Depends(get_db)
):
    """Rotate refresh token and issue new 15-minute access token. Reads from HttpOnly cookie or payload."""
    token_val = req.refresh_token if req else None
    return AuthService.rotate_refresh_token(db, token_val, request, response)


# -------------------------------------------------------------
# Logout & Profile
# -------------------------------------------------------------
@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Logout current user session, revoke session in DB, and clear HttpOnly cookies."""
    session_id = getattr(request.state, "session_id", None)
    if session_id:
        AuthService.revoke_session(db, current_user.id, session_id, session_id, response)
    else:
        AuthService.clear_auth_cookies(response)
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
def get_current_user_profile(current_user: User = Depends(get_current_user)):
    """Get the current authenticated user's profile details."""
    return current_user.to_dict(include_sensitive=True)


# -------------------------------------------------------------
# Device & Session Management (Telegram-like)
# -------------------------------------------------------------
@router.get("/sessions")
def list_active_sessions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List all active device sessions for current user."""
    session_id = getattr(request.state, "session_id", None)
    return AuthService.list_sessions(db, current_user.id, current_session_id=session_id)


@router.delete("/sessions/{session_id}")
def revoke_device_session(
    session_id: str,
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke a specific device session (logout device)."""
    current_sid = getattr(request.state, "session_id", None)
    AuthService.revoke_session(db, current_user.id, session_id, current_sid, response)
    return {"message": "Session terminated successfully"}


@router.post("/sessions/revoke-others")
def revoke_other_sessions(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Revoke all sessions except the current active device."""
    current_sid = getattr(request.state, "session_id", None)
    count = AuthService.revoke_other_sessions(db, current_user.id, current_sid)
    return {"message": f"Terminated {count} other active session(s)"}


# -------------------------------------------------------------
# 2FA Management (TOTP & Recovery Codes)
# -------------------------------------------------------------
@router.post("/2fa/totp/setup")
def setup_totp(current_user: User = Depends(get_current_user)):
    """Initiate TOTP setup, returning secret and SVG QR code."""
    return AuthService.setup_totp(current_user)


@router.post("/2fa/totp/enable")
def enable_totp(
    req: TOTPEnableRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Confirm code from authenticator app to enable 2FA and receive 8 backup recovery codes."""
    recovery_codes = AuthService.enable_totp(db, current_user, req.code)
    return {
        "message": "Two-factor authentication enabled successfully.",
        "recovery_codes": recovery_codes
    }


@router.post("/2fa/totp/disable")
def disable_totp(
    req: TOTPDisableRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Disable 2FA after providing password or valid code."""
    AuthService.disable_totp(db, current_user, code=req.code, password=req.password)
    return {"message": "Two-factor authentication disabled successfully."}


# -------------------------------------------------------------
# Passkeys / WebAuthn
# -------------------------------------------------------------
@router.post("/passkeys/register/options")
def passkey_register_options(current_user: User = Depends(get_current_user)):
    """Get WebAuthn creation options to register a new passkey."""
    return AuthService.get_passkey_register_options(current_user)


@router.post("/passkeys/register/verify")
def passkey_register_verify(
    req: PasskeyRegisterVerifyRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Verify and store a newly created passkey."""
    passkey = AuthService.verify_passkey_register(db, current_user, req.name, req.response)
    return {
        "message": "Passkey registered successfully.",
        "passkey": passkey
    }


@router.post("/passkeys/login/options")
def passkey_login_options(
    identifier: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get WebAuthn authentication options for passkey login."""
    return AuthService.get_passkey_login_options(db, identifier)


@router.post("/passkeys/login/verify", response_model=TokenResponse)
def passkey_login_verify(
    req: PasskeyLoginVerifyRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db)
):
    """Verify passkey assertion and log in passwordlessly."""
    return AuthService.verify_passkey_login(db, req.response, request, response)


@router.get("/passkeys")
def list_passkeys(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List registered passkeys for current user."""
    return AuthService.list_passkeys(db, current_user.id)


@router.delete("/passkeys/{passkey_id}")
def delete_passkey(
    passkey_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a registered passkey."""
    AuthService.delete_passkey(db, current_user.id, passkey_id)
    return {"message": "Passkey deleted successfully."}


# -------------------------------------------------------------
# Password Management
# -------------------------------------------------------------
@router.post("/change-password")
def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Change current user's password."""
    AuthService.change_password(db, current_user, req)
    return {"message": "Password changed successfully"}


@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Request a password reset code sent to the email."""
    code = AuthService.create_reset_code(db, req.email)
    return {
        "message": "Password reset code sent (if email exists).",
        "demo_code": code
    }


@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reset password using the received reset code."""
    AuthService.reset_password(db, req)
    return {"message": "Password has been reset successfully. Please log in."}
