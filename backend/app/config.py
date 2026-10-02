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
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: str = "lax"

    # WebAuthn / Passkeys
    RP_ID: str = "localhost"
    RP_NAME: str = "Real-Time Chat App"
    RP_ORIGIN: str = "http://localhost:8000"

    # Database
    DATABASE_URL: str = f"sqlite:///{BASE_DIR}/chat.db"

    # Cloudinary configuration
    CLOUDINARY_CLOUD_NAME: str = ""
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""

    # Local file upload fallback
    UPLOAD_DIR: str = str(BASE_DIR / "uploads")
    MAX_FILE_SIZE_MB: int = 15
    ALLOWED_EXTENSIONS: list[str] = [
        "png", "jpg", "jpeg", "gif", "webp", "svg",
        "pdf", "doc", "docx", "txt", "zip", "mp3", "mp4"
    ]

    # CORS
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://localhost:8000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "*"
    ]

    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()

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

# Ensure local upload directory exists
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
