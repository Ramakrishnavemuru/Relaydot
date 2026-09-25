import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_messaging_flow():
    # Create user A
    uA = client.post("/api/auth/register", json={
        "username": "ram_user",
        "email": "ram@example.com",
        "password": "password123",
        "confirm_password": "password123",
        "display_name": "Ram"
    }).json()
    tokenA = uA["access_token"]
    uA_id = uA["user"]["id"]

    # Create user B
    uB = client.post("/api/auth/register", json={
        "username": "rahul_user",
        "email": "rahul@example.com",
        "password": "password123",
        "confirm_password": "password123",
        "display_name": "Rahul"
    }).json()
    tokenB = uB["access_token"]
    uB_id = uB["user"]["id"]

    # 1. Start direct conversation
    conv_res = client.post(
        "/api/conversations/direct",
        headers={"Authorization": f"Bearer {tokenA}"},
        json={"recipient_id": uB_id}
    )
    assert conv_res.status_code == 201
    conv = conv_res.json()
    conv_id = conv["id"]

    # 2. Ram sends message to Rahul
    msg_res = client.post(
        "/api/messages",
        headers={"Authorization": f"Bearer {tokenA}"},
        json={
            "conversation_id": conv_id,
            "content": "Hey Rahul! Are you free tomorrow?",
            "message_type": "TEXT"
        }
    )
    assert msg_res.status_code == 201
    msg1 = msg_res.json()
    assert msg1["content"] == "Hey Rahul! Are you free tomorrow?"
    assert msg1["sender_id"] == uA_id

    # 3. Rahul replies to Ram
    reply_res = client.post(
        "/api/messages",
        headers={"Authorization": f"Bearer {tokenB}"},
        json={
            "conversation_id": conv_id,
            "content": "Yeah! Meeting at 10 AM",
            "message_type": "TEXT",
            "reply_to_id": msg1["id"]
        }
    )
    assert reply_res.status_code == 201
    msg2 = reply_res.json()
    assert msg2["reply_to_id"] == msg1["id"]
    assert msg2["reply_to"]["content"] == msg1["content"]

    # 4. Rahul reacts to Ram's message with thumbs up
    reaction_res = client.post(
        f"/api/messages/{msg1['id']}/reaction",
        headers={"Authorization": f"Bearer {tokenB}"},
        json={"emoji": "👍"}
    )
    assert reaction_res.status_code == 200
    reactions = reaction_res.json()["reactions"]
    assert any(r["emoji"] == "👍" and r["user_id"] == uB_id for r in reactions)

    # 5. Ram edits his message
    edit_res = client.put(
        f"/api/messages/{msg1['id']}",
        headers={"Authorization": f"Bearer {tokenA}"},
        json={"content": "Hey Rahul! Are you free tomorrow morning?"}
    )
    assert edit_res.status_code == 200
    assert edit_res.json()["is_edited"] is True
    assert "morning" in edit_res.json()["content"]

    # 6. Read receipts: Rahul marks conversation as read
    read_res = client.post(
        "/api/messages/read",
        headers={"Authorization": f"Bearer {tokenB}"},
        json={"conversation_id": conv_id}
    )
    assert read_res.status_code == 200

    # 7. Search messages
    search_res = client.get(
        "/api/search/messages?q=tomorrow",
        headers={"Authorization": f"Bearer {tokenA}"}
    )
    assert search_res.status_code == 200
    assert len(search_res.json()) >= 1

    # 8. Ram deletes his message (soft delete)
    del_res = client.delete(
        f"/api/messages/{msg1['id']}",
        headers={"Authorization": f"Bearer {tokenA}"}
    )
    assert del_res.status_code == 200
    assert del_res.json()["content"] == "This message was deleted"
    assert del_res.json()["is_deleted"] is True


def test_group_chat_flow():
    # User 1
    u1 = client.post("/api/auth/register", json={
        "username": "admin_priya",
        "email": "priya@example.com",
        "password": "password123",
        "confirm_password": "password123"
    }).json()
    token1 = u1["access_token"]

    # User 2
    u2 = client.post("/api/auth/register", json={
        "username": "member_arjun",
        "email": "arjun@example.com",
        "password": "password123",
        "confirm_password": "password123"
    }).json()
    u2_id = u2["user"]["id"]

    # Create Group "CSE 2027"
    grp_res = client.post(
        "/api/groups",
        headers={"Authorization": f"Bearer {token1}"},
        json={
            "name": "CSE 2027",
            "description": "Computer Science batch 2027",
            "member_ids": [u2_id]
        }
    )
    assert grp_res.status_code == 201
    group_data = grp_res.json()
    grp_id = group_data["id"]
    assert group_data["name"] == "CSE 2027"
    assert len(group_data["members"]) == 2

    # Update group name
    update_res = client.put(
        f"/api/groups/{grp_id}",
        headers={"Authorization": f"Bearer {token1}"},
        json={"name": "CSE 2027 Official"}
    )
    assert update_res.status_code == 200
    assert update_res.json()["name"] == "CSE 2027 Official"
