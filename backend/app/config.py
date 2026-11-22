import os
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    APP_NAME: str = "Real-Time Chat App"
    APP_ENV: str = "development"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api"

    # Security & Tokens
    SECRET_KEY: str = "super-secret-jwt-key-for-realtime-chat-app-2026"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15  # 15 minutes short-lived
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30    # 30 days long-lived
    OTP_EXPIRE_MINUTES: int = 10

    # Cookie settings
    MFA_ENCRYPTION_KEY: str = ""
    SESSION_IDLE_MINUTES: int = 30
    SESSION_ABSOLUTE_HOURS: int = 720
    WS_ALLOW_QUERY_TOKENS: bool = False
    HSTS_ENABLED: bool = False
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"

    # WebAuthn / Passkeys
    RP_ID: str = "localhost"
    RP_NAME: str = "Real-Time Chat App"
    RP_ORIGIN: str = "http://localhost:8000"

    # Staff recovery email. Set STAFF_RECOVERY_ORIGIN to the public HTTPS app origin.
    STAFF_RECOVERY_ORIGIN: str = "http://localhost:8000"
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_EMAIL: str = ""
    SMTP_USE_SSL: bool = False

    # Database
    DATABASE_URL: str = f"sqlite:///{BASE_DIR}/chat.db"

    # Cloudinary configuration
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""

    # Self-hosted Coturn. Comma-separated URLs may include stun:, turn: and turns:.
    STUN_URLS: str = ""
    TURN_URLS: str = ""
    TURN_SHARED_SECRET: str = ""
    TURN_CREDENTIAL_TTL_SECONDS: int = 3600
    WEBRTC_ICE_TRANSPORT_POLICY: str = "all"

    # Local file upload fallback
    UPLOAD_DIR: str = str(BASE_DIR / "uploads")
    CHAT_MEDIA_DIR: str = str(BASE_DIR / "chat_media")  # Private, persistent storage; never mount as static files.
    POST_MEDIA_DIR: str = str(BASE_DIR / "post_media")  # Private post uploads; never mount as static files.
    MAX_FILE_SIZE_MB: int = 15
    ALLOWED_EXTENSIONS: list[str] = [
        "png", "jpg", "jpeg", "gif", "webp", "svg",
        "pdf", "doc", "docx", "txt", "zip", "mp3", "mp4"
    ]

    # CORS
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:8000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
        "http://localhost:5500",
        "http://127.0.0.1:5500"
    ]

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()

if settings.SESSION_IDLE_MINUTES <= 0 or settings.SESSION_ABSOLUTE_HOURS <= 0:
    raise RuntimeError("Session lifetime settings must be positive")
if settings.MFA_ENCRYPTION_KEY:
    from cryptography.fernet import Fernet
    Fernet(settings.MFA_ENCRYPTION_KEY.encode())

if settings.APP_ENV.lower() == "production" or os.environ.get("RENDER") or os.environ.get("RENDER_EXTERNAL_HOSTNAME"):
    if settings.SECRET_KEY == "super-secret-jwt-key-for-realtime-chat-app-2026" or len(settings.SECRET_KEY) < 48:
        raise RuntimeError("Production requires a unique SECRET_KEY of at least 48 characters")
    if not settings.MFA_ENCRYPTION_KEY:
        raise RuntimeError("Production requires MFA_ENCRYPTION_KEY")
    if settings.WS_ALLOW_QUERY_TOKENS:
        raise RuntimeError("WebSocket query authentication must be disabled in production")
    if settings.DEBUG:
        raise RuntimeError("DEBUG must be disabled in production")

# Auto-detect Render environment for WebAuthn, CORS, and Cookies
render_host = os.environ.get("RENDER_EXTERNAL_HOSTNAME")
render_url = os.environ.get("RENDER_EXTERNAL_URL")

if render_host and settings.RP_ID == "localhost":
    settings.RP_ID = render_host

if render_url and settings.RP_ORIGIN == "http://localhost:8000":
    settings.RP_ORIGIN = render_url
    if render_url not in settings.ALLOWED_ORIGINS:
        settings.ALLOWED_ORIGINS.append(render_url)

if (os.environ.get("RENDER") or settings.APP_ENV == "production") and "COOKIE_SECURE" not in os.environ:
    settings.COOKIE_SECURE = True

if settings.APP_ENV.lower() == "production" or os.environ.get("RENDER") or render_host:
    if not settings.COOKIE_SECURE or settings.COOKIE_SAMESITE.lower() not in {"lax", "strict"}:
        raise RuntimeError("Production requires Secure cookies with SameSite=Lax or Strict")

# Ensure local upload directory exists
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
