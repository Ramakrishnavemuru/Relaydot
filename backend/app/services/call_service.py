"""Ephemeral Coturn REST credentials; the shared secret never leaves this server."""
import base64
import hashlib
import hmac
import time
from fastapi import HTTPException
from app.config import settings


def _urls(raw: str, schemes: tuple[str, ...]) -> list[str]:
    urls = [part.strip() for part in raw.split(",") if part.strip()]
    if any(not url.startswith(schemes) for url in urls):
        raise HTTPException(503, "Invalid ICE server configuration")
    return urls


class CallService:
    @staticmethod
    def get_config(user_id: int) -> dict:
        stun = _urls(settings.STUN_URLS, ("stun:", "stuns:"))
        turn = _urls(settings.TURN_URLS, ("turn:", "turns:"))
        production = settings.APP_ENV.lower() == "production"
        if production and (not stun or not turn or not settings.TURN_SHARED_SECRET):
            raise HTTPException(503, "Calling is unavailable: STUN/TURN is not configured")
        if turn and not settings.TURN_SHARED_SECRET:
            raise HTTPException(503, "Calling is unavailable: TURN authentication is not configured")
        policy = settings.WEBRTC_ICE_TRANSPORT_POLICY.lower()
        if policy not in {"all", "relay"} or (policy == "relay" and not turn):
            raise HTTPException(503, "Invalid ICE transport policy")
        servers: list[dict] = [{"urls": stun}] if stun else []
        expiry = None
        if turn:
            ttl = max(300, min(settings.TURN_CREDENTIAL_TTL_SECONDS, 3600))
            expiry = int(time.time()) + ttl
            username = f"{expiry}:{user_id}"
            digest = hmac.new(settings.TURN_SHARED_SECRET.encode(), username.encode(), hashlib.sha1).digest()
            servers.append({"urls": turn, "username": username,
                            "credential": base64.b64encode(digest).decode(),
                            "credentialType": "password"})
        return {"ice_servers": servers, "ice_transport_policy": policy,
                "turn_expires_at": expiry}
