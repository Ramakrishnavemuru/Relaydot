"""Versioned authenticated storage for enrolled authenticator secrets."""
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy.types import TypeDecorator, String
from app.config import settings


def cipher():
    configured = settings.MFA_ENCRYPTION_KEY
    if configured:
        return Fernet(configured.encode())
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=None,
               info=b"relaydot-development-mfa-storage").derive(settings.SECRET_KEY.encode())
    return Fernet(base64.urlsafe_b64encode(key))


class AuthenticatorSecret(TypeDecorator):
    impl = String(512)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if not value or value.startswith("fernet:"):
            return value
        return "fernet:" + cipher().encrypt(value.encode()).decode()

    def process_result_value(self, value, dialect):
        if value and value.startswith("fernet:"):
            return cipher().decrypt(value[7:].encode()).decode()
        return value
