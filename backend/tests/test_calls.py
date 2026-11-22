import base64
import hashlib
import hmac
import time
from conftest import BrowserTestClient as TestClient
from fastapi import HTTPException
import pytest
from app.config import settings
from app.main import app
from app.services.call_service import CallService

client = TestClient(app)


def _token():
    res = client.post("/api/auth/register", json={
        "username": "caller_test",
        "email": "caller@example.com",
        "password": "password123",
        "confirm_password": "password123"
    })
    assert res.status_code in (200, 201)
    return res.json()["access_token"]


def test_get_call_config(monkeypatch):
    monkeypatch.setattr(settings, "STUN_URLS", "stun:turn.example.com:3478")
    monkeypatch.setattr(settings, "TURN_URLS", "turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp")
    monkeypatch.setattr(settings, "TURN_SHARED_SECRET", "testing-shared-secret")
    monkeypatch.setattr(settings, "TURN_CREDENTIAL_TTL_SECONDS", 600)
    config_res = client.get(
        "/api/calls/config",
        headers={"Authorization": f"Bearer {_token()}"}
    )
    assert config_res.status_code == 200
    assert config_res.headers["cache-control"] == "no-store, private"
    data = config_res.json()
    assert data["ice_transport_policy"] == "all"
    assert data["ice_servers"][0]["urls"] == ["stun:turn.example.com:3478"]
    turn = data["ice_servers"][1]
    assert len(turn["urls"]) == 2
    assert turn["credentialType"] == "password"
    expiry, user_id = turn["username"].split(":")
    assert user_id.isdigit()
    assert 0 < int(expiry) - int(time.time()) <= 600
    expected = base64.b64encode(hmac.new(b"testing-shared-secret", turn["username"].encode(), hashlib.sha1).digest()).decode()
    assert turn["credential"] == expected
    assert "testing-shared-secret" not in config_res.text
    assert "google" not in config_res.text.lower()


def test_production_refuses_unconfigured_turn(monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(settings, "STUN_URLS", "stun:turn.example.com:3478")
    monkeypatch.setattr(settings, "TURN_URLS", "")
    monkeypatch.setattr(settings, "TURN_SHARED_SECRET", "")
    with pytest.raises(HTTPException) as error:
        CallService.get_config(1)
    assert error.value.status_code == 503
