from conftest import BrowserTestClient as TestClient
from sqlalchemy import create_engine
from sqlalchemy import text as sql_text
import importlib

from conftest import TestingSessionLocal
from app.models.attachment import Attachment
from app.models.user import User

from app.main import app
from app.routes import messages as message_routes


def register(client: TestClient, name: str):
    response = client.post("/api/auth/register", json={
        "username": name, "email": f"{name}@example.com", "password": "password123",
        "confirm_password": "password123"})
    assert response.status_code == 201
    result = response.json()
    return result["user"]["id"], {"Authorization": f"Bearer {result['access_token']}"}, result["access_token"]


def test_chat_links_and_foreign_object_access():
    client = TestClient(app)
    alice, a, token_a = register(client, "chat_alice")
    bob, b, _ = register(client, "chat_bob")
    carol, c, _ = register(client, "chat_carol")
    dave, d, _ = register(client, "chat_dave")
    own = client.post("/api/conversations/direct", headers=a, json={"recipient_id": bob}).json()
    foreign = client.post("/api/conversations/direct", headers=c, json={"recipient_id": dave}).json()
    assert len(own["public_id"]) == 32
    assert own["public_id"] != foreign["public_id"]
    assert client.get(f"/api/conversations/{own['id']}", headers=a).status_code == 200
    assert client.get(f"/api/conversations/{foreign['id']}", headers=a).status_code == 404
    assert all(row["id"] != foreign["id"] for row in client.get("/api/conversations", headers=a).json())

    message = client.post("/api/messages", headers=c, json={
        "conversation_id": foreign["id"], "content": "private text"}).json()
    assert client.get(f"/api/messages/conversation/{foreign['id']}", headers=a).status_code == 404
    assert client.post("/api/messages", headers=a, json={
        "conversation_id": foreign["id"], "content": "forged"}).status_code == 404
    assert client.put(f"/api/messages/{message['id']}", headers=a, json={"content": "changed"}).status_code == 404
    assert client.delete(f"/api/messages/{message['id']}", headers=a).status_code == 404
    assert client.post("/api/messages/read", headers=a, json={"conversation_id": foreign["id"]}).status_code == 404
    assert client.get(f"/api/search/messages?q=private&conversation_id={foreign['id']}", headers=a).json() == []
    with client.websocket_connect(f"/ws?token={token_a}") as ws:
        ws.send_json({"event": "message", "data": {"conversation_id": foreign["id"], "content": "forged socket"}})
        assert ws.receive_json()["event"] == "error"
    assert len(client.get(f"/api/messages/conversation/{foreign['id']}", headers=c).json()) == 1


def test_private_chat_attachments_and_revoked_membership(tmp_path, monkeypatch):
    monkeypatch.setattr(message_routes, "CHAT_MEDIA_DIR", tmp_path)
    client = TestClient(app)
    alice, a, _ = register(client, "media_alice")
    bob, b, token_b = register(client, "media_bob")
    carol, c, _ = register(client, "media_carol")
    group = client.post("/api/groups", headers=a, json={
        "name": "Private group", "member_ids": [bob]}).json()
    uploaded = client.post("/api/messages/uploads", headers=a,
        files={"file": ("sample.png", b"\x89PNG\r\n\x1a\nprivate", "image/png")})
    assert uploaded.status_code == 201, uploaded.text
    metadata = uploaded.json()
    url = metadata["file_url"]
    assert url.startswith("/api/messages/attachments/")
    assert client.get(url, headers=a).status_code == 200
    assert client.get(url, headers=c).status_code == 404
    forged = client.post("/api/messages", headers=c, json={
        "conversation_id": group["id"], "content": "", "attachments": [metadata]})
    assert forged.status_code == 404
    wrong_owner = client.post("/api/messages", headers=b, json={
        "conversation_id": group["id"], "content": "", "attachments": [metadata]})
    assert wrong_owner.status_code == 404
    sent = client.post("/api/messages", headers=a, json={
        "conversation_id": group["id"], "content": "image", "message_type": "IMAGE",
        "attachments": [metadata]})
    assert sent.status_code == 201, sent.text
    assert client.get(url, headers=b).status_code == 200
    assert client.get(url, headers=c).status_code == 404
    second = client.post("/api/conversations/direct", headers=a,
        json={"recipient_id": carol}).json()
    forwarded = client.post(f"/api/messages/{sent.json()['id']}/forward", headers=a,
        json={"conversation_ids": [second["id"]]})
    assert forwarded.status_code == 200, forwarded.text
    assert client.get(url, headers=c).status_code == 200
    assert client.post("/api/messages", headers=a, json={
        "conversation_id": group["id"], "content": "again", "attachments": [metadata]}).status_code == 404
    assert client.post("/api/messages", headers=a, json={
        "conversation_id": group["id"], "content": "forged",
        "attachments": [{**metadata, "file_url": "/uploads/someone-elses-file.png"}]}).status_code == 422
    removed = client.delete(f"/api/groups/{group['id']}/members/{bob}", headers=a)
    assert removed.status_code == 200, removed.text
    assert client.get(url, headers=b).status_code == 404
    assert client.get(url, headers=c).status_code == 200
    assert client.get(f"/api/messages/conversation/{group['id']}", headers=b).status_code == 404
    with client.websocket_connect(f"/ws?token={token_b}") as ws:
        ws.send_json({"event": "message", "data": {"conversation_id": group["id"], "content": "after removal"}})
        assert ws.receive_json()["event"] == "error"


def test_legacy_local_attachment_is_membership_protected(tmp_path, monkeypatch):
    migration = importlib.import_module("app.main")
    monkeypatch.setattr(migration, "SessionLocal", TestingSessionLocal)
    mount = next(route.app for route in app.routes if route.path == "/uploads")
    monkeypatch.setattr(mount, "directory", str(tmp_path))
    monkeypatch.setattr(mount, "all_directories", [str(tmp_path)])
    (tmp_path / "legacy.txt").write_text("private legacy file")
    client = TestClient(app)
    alice, a, _ = register(client, "legacy_alice")
    bob, b, _ = register(client, "legacy_bob")
    _, stranger, _ = register(client, "legacy_stranger")
    conv = client.post("/api/conversations/direct", headers=a, json={"recipient_id": bob}).json()
    sent = client.post("/api/messages", headers=a, json={
        "conversation_id": conv["id"], "content": "legacy"}).json()
    with TestingSessionLocal() as db:
        db.add(Attachment(message_id=sent["id"], file_url="/uploads/legacy.txt",
                          file_name="legacy.txt", file_type="text/plain", file_size=19))
        db.commit()
    assert client.get("/uploads/legacy.txt", headers=a).status_code == 200
    assert client.get("/uploads/legacy.txt", headers=b).status_code == 200
    assert client.get("/uploads/legacy.txt", headers=stranger).status_code == 404
    assert client.get("/uploads/legacy.txt").status_code == 404
    with TestingSessionLocal() as db:
        db.get(User, alice).avatar_url = "/uploads/legacy.txt"
        db.commit()
    assert client.get("/uploads/legacy.txt").status_code == 200


def test_existing_conversations_receive_stable_opaque_ids(tmp_path, monkeypatch):
    migration = importlib.import_module("app.main")
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE conversations (id INTEGER PRIMARY KEY, type VARCHAR(20))")
        conn.exec_driver_sql("INSERT INTO conversations (id, type) VALUES (1, 'DIRECT'), (2, 'GROUP')")
    monkeypatch.setattr(migration, "engine", engine)
    migration.run_schema_migrations()
    with engine.connect() as conn:
        first = conn.execute(sql_text("SELECT id, public_id FROM conversations ORDER BY id")).all()
    assert len(first) == 2 and all(len(row.public_id) == 32 for row in first)
    assert first[0].public_id != first[1].public_id
    migration.run_schema_migrations()
    with engine.connect() as conn:
        assert conn.execute(sql_text("SELECT id, public_id FROM conversations ORDER BY id")).all() == first
