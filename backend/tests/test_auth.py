import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_register_and_login():
    username = "test_alice"
    email = "alice@example.com"
    password = "password123"

    # Register
    reg_response = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": password,
            "confirm_password": password,
            "display_name": "Alice Wonderland"
        }
    )
    assert reg_response.status_code == 201
    data = reg_response.json()
    assert "access_token" in data
    assert data["user"]["username"] == username

    # Login with username
    login_response = client.post(
        "/api/auth/login",
        json={
            "username_or_email": username,
            "password": password
        }
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    assert token

    # Login with email
    login_email_res = client.post(
        "/api/auth/login",
        json={
            "username_or_email": email,
            "password": password
        }
    )
    assert login_email_res.status_code == 200

    # Get current user profile
    me_response = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert me_response.status_code == 200
    assert me_response.json()["email"] == email


def test_register_duplicate_username():
    client.post(
        "/api/auth/register",
        json={
            "username": "dup_user",
            "email": "dup1@example.com",
            "password": "password123",
            "confirm_password": "password123"
        }
    )
    res = client.post(
        "/api/auth/register",
        json={
            "username": "dup_user",
            "email": "dup2@example.com",
            "password": "password123",
            "confirm_password": "password123"
        }
    )
    assert res.status_code == 400


def test_change_password():
    username = "test_bob"
    email = "bob@example.com"
    pwd = "original_password"

    reg = client.post(
        "/api/auth/register",
        json={
            "username": username,
            "email": email,
            "password": pwd,
            "confirm_password": pwd
        }
    )
    token = reg.json()["access_token"]

    change_res = client.post(
        "/api/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "current_password": pwd,
            "new_password": "new_password_123",
            "confirm_new_password": "new_password_123"
        }
    )
    assert change_res.status_code == 200

    # Login with new password
    login_res = client.post(
        "/api/auth/login",
        json={
            "username_or_email": username,
            "password": "new_password_123"
        }
    )
    assert login_res.status_code == 200
