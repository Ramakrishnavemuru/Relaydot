import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_user_profile_and_search():
    # Register user1
    u1 = client.post("/api/auth/register", json={
        "username": "user_charlie",
        "email": "charlie@example.com",
        "password": "password123",
        "confirm_password": "password123",
        "display_name": "Charlie Chaplin"
    }).json()
    token1 = u1["access_token"]
    u1_id = u1["user"]["id"]

    # Register user2
    u2 = client.post("/api/auth/register", json={
        "username": "user_david",
        "email": "david@example.com",
        "password": "password123",
        "confirm_password": "password123",
        "display_name": "David Bowie"
    }).json()
    token2 = u2["access_token"]
    u2_id = u2["user"]["id"]

    # Update profile
    update_res = client.put(
        "/api/users/profile",
        headers={"Authorization": f"Bearer {token1}"},
        json={"display_name": "Charlie Updated", "bio": "Hello from tests"}
    )
    assert update_res.status_code == 200
    assert update_res.json()["display_name"] == "Charlie Updated"
    assert update_res.json()["bio"] == "Hello from tests"

    # Search user
    search_res = client.get(
        "/api/users/search?q=david",
        headers={"Authorization": f"Bearer {token1}"}
    )
    assert search_res.status_code == 200
    results = search_res.json()
    assert any(u["username"] == "user_david" for u in results)

    # Block user2
    block_res = client.post(
        f"/api/users/{u2_id}/block",
        headers={"Authorization": f"Bearer {token1}"}
    )
    assert block_res.status_code == 200

    # User2 should not show in search results
    search_after_block = client.get(
        "/api/users/search?q=david",
        headers={"Authorization": f"Bearer {token1}"}
    )
    assert not any(u["username"] == "user_david" for u in search_after_block.json())

    # List blocked users
    blocked_list = client.get(
        "/api/users/blocked/list",
        headers={"Authorization": f"Bearer {token1}"}
    )
    assert any(u["id"] == u2_id for u in blocked_list.json())

    # Unblock
    unblock_res = client.delete(
        f"/api/users/{u2_id}/block",
        headers={"Authorization": f"Bearer {token1}"}
    )
    assert unblock_res.status_code == 200
