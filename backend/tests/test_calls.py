import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_get_call_config():
    # Register user
    res = client.post("/api/auth/register", json={
        "username": "caller_test",
        "email": "caller@example.com",
        "password": "password123",
        "confirm_password": "password123"
    })
    token = res.json()["access_token"]

    # Request call ICE servers config
    config_res = client.get(
        "/api/calls/config",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert config_res.status_code == 200
    data = config_res.json()
    assert "ice_servers" in data
    assert len(data["ice_servers"]) >= 1
    assert any("stun:" in s["urls"] for s in data["ice_servers"])
