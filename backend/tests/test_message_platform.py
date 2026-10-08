"""New message controls must preserve membership and survive delivery/expiry ticks."""
import asyncio
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from app.main import app
from app.models.message import Message, ScheduledMessage
from app.services import scheduled_service
from conftest import TestingSessionLocal


def account(client, name):
    result = client.post('/api/auth/register', json={'username': name,
        'email': f'{name}@example.com', 'password': 'password123',
        'confirm_password': 'password123'})
    assert result.status_code == 201, result.text
    body = result.json()
    return body['user']['id'], {'Authorization': f"Bearer {body['access_token']}"}


def test_threads_forwarding_bookmarks_pins_and_authorization():
    client = TestClient(app)
    alice, ah = account(client, 'platform_alice')
    bob, bh = account(client, 'platform_bob')
    cara, ch = account(client, 'platform_cara')
    ab = client.post('/api/conversations/direct', headers=ah, json={'recipient_id':bob}).json()['id']
    ac = client.post('/api/conversations/direct', headers=ah, json={'recipient_id':cara}).json()['id']
    root = client.post('/api/messages', headers=ah, json={'conversation_id':ab,'content':'A topic'}).json()
    other = client.post('/api/messages', headers=ah, json={'conversation_id':ac,'content':'Secret'}).json()
    bad = client.post('/api/messages', headers=bh, json={'conversation_id':ab,'content':'Leak',
        'reply_to_id':other['id']})
    assert bad.status_code == 400
    assert client.post('/api/messages/read', headers=ch, json={'conversation_id':ab}).status_code == 403
    assert client.get(f"/api/messages/{root['id']}/thread", headers=ch).status_code == 404
    reply = client.post('/api/messages', headers=bh, json={'conversation_id':ab,
        'content':'Thread reply', 'thread_root_id':root['id']})
    assert reply.status_code == 201, reply.text
    assert reply.json()['thread_root_id'] == root['id']
    assert len(client.get(f"/api/messages/{root['id']}/thread", headers=ah).json()) == 1
    history = client.get(f'/api/messages/conversation/{ab}', headers=ah).json()
    assert [m['id'] for m in history] == [root['id']]
    assert history[0]['thread_reply_count'] == 1
    assert client.post(f"/api/messages/{root['id']}/bookmark", headers=bh).json()['bookmarked']
    assert len(client.get('/api/messages/bookmarks', headers=bh).json()) == 1
    assert client.delete(f"/api/messages/{root['id']}/bookmark", headers=bh).status_code == 200
    assert client.post(f"/api/messages/{root['id']}/pin", headers=bh).json()['pinned_at']
    assert client.delete(f"/api/messages/{root['id']}/pin", headers=bh).json()['pinned_at'] is None
    assert client.post(f"/api/messages/{other['id']}/forward", headers=bh,
        json={'conversation_ids':[ab]}).status_code == 404
    forwarded = client.post(f"/api/messages/{root['id']}/forward", headers=ah,
        json={'conversation_ids':[ac]})
    assert forwarded.status_code == 200, forwarded.text
    assert forwarded.json()[0]['is_forwarded'] is True
    assert client.get('/api/search/messages', headers=ah,
        params={'q':'Secret','conversation_id':ab}).json() == []
    assert client.get('/api/search/messages', headers=ah,
        params={'q':'Secret','conversation_id':ac,'sender':'platform_alice'}).json()[0]['message_id'] == other['id']
    assert client.get('/api/search/messages', headers=ch,
        params={'q':'A topic'}).json()[0]['message_id'] == forwarded.json()[0]['id']
    assert client.get('/api/search/messages', headers=bh,
        params={'q':'Secret'}).json() == []
    assert client.get('/api/search/messages', headers=ch,
        params={'q':'A topic','conversation_id':ab}).json() == []
    assert client.get('/api/search/messages', headers=ah,
        params={'conversation_id':ac,'sender':'platform_alice'}).status_code == 200
    assert client.post('/api/messages/scheduled', headers=ah, json={
        'conversation_id':ab, 'content':'Wrong thread',
        'send_at':(datetime.now(timezone.utc)+timedelta(minutes=2)).isoformat(),
        'thread_root_id':other['id']}).status_code == 400


def test_unread_badge_matches_readable_messages():
    client = TestClient(app)
    alice, ah = account(client, 'unread_alice')
    _, bh = account(client, 'unread_bob')
    conversation_id = client.post('/api/conversations/direct', headers=ah,
        json={'recipient_id':client.get('/api/auth/me', headers=bh).json()['id']}).json()['id']

    def unread_count():
        rows = client.get('/api/conversations', headers=bh).json()
        return next(row['unread_count'] for row in rows if row['id'] == conversation_id)

    deleted = client.post('/api/messages', headers=ah,
        json={'conversation_id':conversation_id, 'content':'Deleted shortly'}).json()
    expiring = client.post('/api/messages', headers=ah,
        json={'conversation_id':conversation_id, 'content':'Expired shortly'}).json()
    assert unread_count() == 2
    assert client.delete(f"/api/messages/{deleted['id']}", headers=ah).status_code == 200
    with TestingSessionLocal() as db:
        db.get(Message, expiring['id']).expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert unread_count() == 0
    assert client.post('/api/messages/read', headers=bh,
        json={'conversation_id':conversation_id}).json()['count'] == 0

    client.post('/api/messages', headers=ah,
        json={'conversation_id':conversation_id, 'content':'Fresh message'})
    assert unread_count() == 1
    assert client.post('/api/messages/read', headers=bh,
        json={'conversation_id':conversation_id}).json()['count'] == 1
    assert unread_count() == 0


def test_scheduled_delivery_and_disappearing_cleanup(monkeypatch):
    monkeypatch.setattr(scheduled_service, 'SessionLocal', TestingSessionLocal)
    client = TestClient(app)
    alice, ah = account(client, 'platform_dina')
    bob, bh = account(client, 'platform_erin')
    conversation = client.post('/api/conversations/direct', headers=ah,
        json={'recipient_id':bob}).json()['id']
    send_at = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat()
    scheduled = client.post('/api/messages/scheduled', headers=ah,
        json={'conversation_id':conversation,'content':'Later','send_at':send_at,
            'expires_in_seconds':10})
    assert scheduled.status_code == 201, scheduled.text
    assert client.get('/api/messages/scheduled', headers=bh).json() == []
    with TestingSessionLocal() as db:
        job = db.get(ScheduledMessage, scheduled.json()['id'])
        job.send_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    asyncio.run(scheduled_service.process_due_messages())
    asyncio.run(scheduled_service.process_due_messages())
    history = client.get(f'/api/messages/conversation/{conversation}', headers=bh).json()
    assert [m['content'] for m in history] == ['Later']
    assert history[0]['expires_at'] is not None
    assert client.get('/api/messages/scheduled', headers=ah).json() == []
    expiring = client.post('/api/messages', headers=ah, json={'conversation_id':conversation,
        'content':'Temporary', 'expires_in_seconds':10}).json()
    with TestingSessionLocal() as db:
        db.get(Message, expiring['id']).expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert 'Temporary' not in [m['content'] for m in client.get(
        f'/api/messages/conversation/{conversation}', headers=bh).json()]
    asyncio.run(scheduled_service.expire_messages())
    with TestingSessionLocal() as db:
        expired = db.get(Message, expiring['id'])
        assert expired.content == '' and expired.deleted_at is not None


def test_existing_message_table_migrates_without_losing_rows(tmp_path, monkeypatch):
    from sqlalchemy import create_engine, inspect
    from app import main
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.exec_driver_sql("CREATE TABLE messages (id INTEGER PRIMARY KEY, content TEXT)")
        conn.exec_driver_sql("INSERT INTO messages (id, content) VALUES (1, 'kept')")
        conn.exec_driver_sql("CREATE TABLE scheduled_messages (id INTEGER PRIMARY KEY, content TEXT)")
    monkeypatch.setattr(main, 'engine', engine)
    main.run_schema_migrations()
    with engine.connect() as conn:
        assert conn.exec_driver_sql('SELECT content FROM messages WHERE id=1').scalar() == 'kept'
    columns = {c['name'] for c in inspect(engine).get_columns('messages')}
    assert {'thread_root_id','expires_at','pinned_at','pinned_by_id','is_forwarded','scheduled_message_id'} <= columns
    assert 'expires_in_seconds' in {column['name'] for column in inspect(engine).get_columns('scheduled_messages')}
