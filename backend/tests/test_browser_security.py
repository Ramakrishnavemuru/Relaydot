from datetime import datetime, timedelta, timezone
import pyotp
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.models.user import User
from app.models.session import UserSession
from app.security.browser_session import cookie_name
from conftest import TestingSessionLocal


def register(client, name="secure_browser"):
    response = client.post("/api/auth/register", json={
        "username": name, "email": f"{name}@example.com", "password": "password123",
        "confirm_password": "password123"})
    assert response.status_code == 201, response.text
    return response


def csrf(client):
    response = client.get("/api/auth/csrf")
    assert response.status_code == 200, response.text
    return {"X-CSRF-Token": response.json()["csrf_token"]}


def test_opaque_cookie_csrf_logout_and_headers():
    client = TestClient(app)
    response = register(client)
    raw = client.cookies.get(cookie_name())
    assert raw and "." not in raw
    assert not client.cookies.get("access_token")
    assert not client.cookies.get("refresh_token")
    with TestingSessionLocal() as db:
        session = db.query(UserSession).one()
        assert session.refresh_token_hash != raw
    assert client.post("/api/auth/logout").status_code == 403
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": "wrong"}).status_code == 403
    assert client.post("/api/auth/logout", headers={**csrf(client), "Origin": "https://attacker.invalid"}).status_code == 403
    headers = csrf(client)
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_rotation_invalidates_old_cookie_and_csrf():
    client = TestClient(app)
    register(client)
    previous = client.cookies.get(cookie_name())
    old_csrf = csrf(client)
    assert client.post("/api/auth/refresh", headers=old_csrf).status_code == 200
    assert client.cookies.get(cookie_name()) != previous
    assert client.post("/api/auth/sessions/revoke-others", headers=old_csrf).status_code == 403
    attacker = TestClient(app)
    attacker.cookies.set(cookie_name(), previous)
    assert attacker.get("/api/auth/me").status_code == 401


def test_idle_and_absolute_expiration():
    client = TestClient(app)
    register(client)
    with TestingSessionLocal() as db:
        session = db.query(UserSession).one()
        session.last_active = datetime.now(timezone.utc) - timedelta(minutes=settings.SESSION_IDLE_MINUTES + 1)
        db.commit()
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/refresh").status_code == 401


def test_production_cookie_attributes(monkeypatch):
    monkeypatch.setattr(settings, "COOKIE_SECURE", True)
    client = TestClient(app, base_url="https://testserver")
    response = register(client)
    header = next(value for value in response.headers.get_list("set-cookie")
                  if value.startswith("__Host-relaydot_session="))
    assert "Secure" in header and "HttpOnly" in header
    assert "SameSite=lax" in header and "Path=/" in header and "Domain=" not in header


def test_totp_seed_is_encrypted_at_rest_and_code_cannot_replay():
    client = TestClient(app)
    body = register(client).json()
    secret = pyotp.random_base32()
    with TestingSessionLocal() as db:
        user = db.get(User, body["user"]["id"])
        user.totp_secret = secret
        user.totp_enabled = True
        db.commit()
        from sqlalchemy import text
        stored = db.execute(text("SELECT totp_secret FROM users WHERE id=:id"), {"id": user.id}).scalar()
        assert stored.startswith("fernet:") and secret not in stored
        assert user.totp_secret == secret
    code = pyotp.TOTP(secret).now()
    first = TestClient(app)
    ticket = first.post("/api/auth/login", json={"username_or_email": "secure_browser", "password": "password123"}).json()["ticket"]
    assert first.post("/api/auth/2fa/verify", json={"ticket": ticket, "code": code}).status_code == 200
    second = TestClient(app)
    ticket2 = second.post("/api/auth/login", json={"username_or_email": "secure_browser", "password": "password123"}).json()["ticket"]
    assert second.post("/api/auth/2fa/verify", json={"ticket": ticket2, "code": code}).status_code == 400


def test_socket_query_tokens_disabled_and_origin_checked(monkeypatch):
    from starlette.websockets import WebSocketDisconnect
    import pytest
    monkeypatch.setattr(settings, "WS_ALLOW_QUERY_TOKENS", False)
    client = TestClient(app)
    body = register(client).json()
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws?token=" + body["access_token"]):
            pass
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws", headers={"Origin": "https://attacker.invalid"}):
            pass


def test_html_csp_uses_hash_and_restricts_frames():
    client = TestClient(app)
    response = client.get("/app/login")
    policy = response.headers["content-security-policy"]
    assert "'sha256-" in policy and "frame-ancestors 'none'" in policy
    assert "script-src 'self' 'unsafe-inline'" not in policy


def test_sensitive_settings_require_reauthentication_and_rotate_cookie():
    client = TestClient(app)
    register(client)
    with TestingSessionLocal() as db:
        session = db.query(UserSession).one()
        session.created_at = datetime.now(timezone.utc) - timedelta(minutes=11)
        db.commit()
    assert client.post('/api/auth/2fa/totp/setup', headers=csrf(client)).status_code == 403
    old_cookie = client.cookies.get(cookie_name())
    assert client.post('/api/auth/reauthenticate', headers=csrf(client), json={'password': 'wrong'}).status_code == 400
    verified = client.post('/api/auth/reauthenticate', headers=csrf(client), json={'password': 'password123'})
    assert verified.status_code == 200, verified.text
    assert client.cookies.get(cookie_name()) != old_cookie
    assert client.post('/api/auth/2fa/totp/setup', headers=csrf(client)).status_code == 200


def test_recovery_regeneration_revokes_previous_codes_and_requires_factor():
    client = TestClient(app)
    register(client)
    secret = client.post('/api/auth/2fa/totp/setup', headers=csrf(client)).json()['secret']
    code = pyotp.TOTP(secret).now()
    activated = client.post('/api/auth/2fa/totp/enable', headers=csrf(client), json={'code': code})
    assert activated.status_code == 200
    old = activated.json()['recovery_codes']
    # An enrollment code is already consumed, including for reauthentication.
    assert client.post('/api/auth/reauthenticate', headers=csrf(client),
                       json={'password': 'password123', 'code': code}).status_code == 400
    assert client.post('/api/auth/reauthenticate', headers=csrf(client),
                       json={'password': 'password123', 'code': old[0]}).status_code == 200
    replaced = client.post('/api/auth/2fa/recovery-codes/regenerate', headers=csrf(client), json={'code': old[1]})
    assert replaced.status_code == 200, replaced.text
    assert len(replaced.json()['recovery_codes']) == 8
    assert client.post('/api/auth/reauthenticate', headers=csrf(client),
                       json={'password': 'password123', 'code': old[2]}).status_code == 400
    assert client.post('/api/auth/reauthenticate', headers=csrf(client),
                       json={'password': 'password123', 'code': replaced.json()['recovery_codes'][0]}).status_code == 200


def test_expired_cookie_does_not_prevent_new_login():
    client = TestClient(app)
    register(client)
    with TestingSessionLocal() as db:
        db.query(UserSession).update({'revoked': True})
        db.commit()
    response = client.post('/api/auth/login', json={'username_or_email': 'secure_browser', 'password': 'password123'})
    assert response.status_code == 200, response.text
    assert response.headers['x-content-type-options'] == 'nosniff'
