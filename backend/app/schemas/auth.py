from typing import Optional, List, Dict, Any
from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=30)
    email: Optional[EmailStr] = None
    phone_number: Optional[str] = None
    password: Optional[str] = Field(None, min_length=6, max_length=72)
    confirm_password: Optional[str] = Field(None, min_length=6, max_length=72)
    display_name: Optional[str] = None
    otp_code: Optional[str] = None


class SendOTPRequest(BaseModel):
    identifier: str = Field(..., description="Email address or phone number")
    purpose: str = Field("LOGIN", description="REGISTER, LOGIN, or VERIFY")


class VerifyOTPRequest(BaseModel):
    identifier: str
    otp_code: str
    purpose: str = "REGISTER"


class LoginRequest(BaseModel):
    # Username, email, or phone number
    username_or_email: Optional[str] = None
    identifier: Optional[str] = None  # alias
    password: Optional[str] = None


class OTPLoginRequest(BaseModel):
    identifier: str
    otp_code: str


class RefreshTokenRequest(BaseModel):
    refresh_token: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    session_id: Optional[str] = None
    user: Optional[dict] = None
    requires_2fa: bool = False
    ticket: Optional[str] = None
    methods: Optional[List[str]] = None
    demo_code: Optional[str] = None


class TwoFactorVerifyRequest(BaseModel):
    ticket: str
    code: str  # 6-digit TOTP or recovery code


class TOTPEnableRequest(BaseModel):
    code: str


class TOTPDisableRequest(BaseModel):
    code: Optional[str] = None
    password: Optional[str] = None


class PasskeyRegisterVerifyRequest(BaseModel):
    name: str = "My Passkey"
    response: Dict[str, Any]


class PasskeyLoginVerifyRequest(BaseModel):
    challenge_id: str
    response: Dict[str, Any]


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=6, max_length=72)
    confirm_new_password: str = Field(..., min_length=6, max_length=72)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    reset_code: str
    new_password: str = Field(..., min_length=6, max_length=72)
