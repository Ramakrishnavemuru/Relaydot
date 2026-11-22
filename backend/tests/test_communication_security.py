"""Unsupported encryption must never be silently accepted as a plaintext send."""
import pytest
from conftest import BrowserTestClient as TestClient
from pydantic import ValidationError
from app.main import app
from app.schemas.message import MessageCreate, MessageEdit, ScheduledMessageCreate
from app.models.message import Message
from conftest import TestingSessionLocal
from test_message_platform import account


@pytest.mark.parametrize("extra", [
    {"encryption_version": 1},
    {"ciphertext": "opaque"},
    {"encrypted_metadata": "opaque"},
    {"e2ee": True},
])
def test_rejects_unsupported_message_envelopes(extra):
    with pytest.raises(ValidationError):
        MessageCreate.model_validate({"conversation_id": 1, "content": "must not send", **extra})
    with pytest.raises(ValidationError):
        MessageEdit.model_validate({"content": "must not edit", **extra})
    with pytest.raises(ValidationError):
        ScheduledMessageCreate.model_validate({
            "conversation_id": 1, "content": "must not schedule",
            "send_at": "2030-01-01T12:00:00Z", **extra})


def test_security_status_requires_membership_and_rejects_downgrade():
    client = TestClient(app)
    _, alice = account(client, "security_alice")
    bob_id, _ = account(client, "security_bob")
    _, eve = account(client, "security_eve")
    conversation = client.post("/api/conversations/direct", headers=alice,
                               json={"recipient_id": bob_id}).json()["id"]
    path = f"/api/messages/conversations/{conversation}/security"
    assert client.get(path, headers=eve).status_code == 404
    response = client.get(path, headers=alice)
    assert response.status_code == 200
    assert response.json()["e2ee_enabled"] is False
    assert response.json()["messages"] == "SERVER_READABLE"
    assert response.json()["call_peer_identity"] == "SERVER_AUTHENTICATED_ONLY"
    result = client.post("/api/messages", headers=alice, json={
        "conversation_id": conversation, "content": "do not store",
        "encryption_version": 1, "ciphertext": "unrecognized"})
    assert result.status_code == 422
    with TestingSessionLocal() as db:
        assert db.query(Message).count() == 0
    legacy = client.post("/api/messages", headers=alice, json={
        "conversation_id": conversation, "content": "explicit legacy message"})
    assert legacy.status_code == 201
    assert legacy.json()["encryption_version"] == 0


def test_websocket_does_not_drop_encryption_intent():
    from test_realtime_contracts import account as socket_account, receive
    client = TestClient(app)
    alice, headers = socket_account(client, "envelope_alice")
    bob, _ = socket_account(client, "envelope_bob")
    conversation = client.post("/api/conversations/direct", headers=headers,
        json={"recipient_id": bob["user"]["id"]}).json()["id"]
    with client.websocket_connect(f"/ws?token={alice['access_token']}") as socket:
        socket.send_json({"event": "message", "data": {
            "conversation_id": conversation, "content": "never store this body",
            "encryption_version": 1, "ciphertext": "unrecognized"}})
        assert receive(socket, "error")["detail"] == "Message could not be sent to this conversation"
    with TestingSessionLocal() as db:
        assert db.query(Message).count() == 0
