"""Capabilities describe deployed protection, never an intended future protocol."""

LEGACY_ENCRYPTION_VERSION = 0


def communication_security_status() -> dict:
    return {
        "encryption_version": LEGACY_ENCRYPTION_VERSION,
        "e2ee_enabled": False,
        "messages": "SERVER_READABLE",
        "attachments": "SERVER_READABLE",
        "identity_verification": "UNAVAILABLE",
        "forward_secrecy": False,
        "post_compromise_recovery": False,
        "calls": "WEBRTC_DTLS_SRTP",
        "call_peer_identity": "SERVER_AUTHENTICATED_ONLY",
        "group_calls": "UNSUPPORTED",
        "reason": "A reviewed browser messaging protocol has not been integrated.",
    }
