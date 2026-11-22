"""Social integration: persisted data, privacy, ownership and chat reuse."""
from conftest import BrowserTestClient as TestClient
from app.main import app


def account(client, name):
    res = client.post('/api/auth/register', json={
        'username': name, 'email': f'{name}@example.com', 'password': 'password123',
        'confirm_password': 'password123', 'display_name': name.title()})
    assert res.status_code == 201, res.text
    data = res.json()
    return data['user']['id'], {'Authorization': f"Bearer {data['access_token']}"}


def api(client, method, path, headers, payload=None):
    return client.request(method, '/api/social' + path, headers=headers, json=payload)


def test_posts_visibility_follow_block_and_search():
    client = TestClient(app)
    a, ah = account(client, 'social_alice')
    b, bh = account(client, 'social_bob')
    c, ch = account(client, 'social_cara')
    created = api(client, 'POST', '/posts', ah, {'content':'Hello #FastAPI @social_bob', 'visibility':'FOLLOWERS'})
    assert created.status_code == 201, created.text
    pid = created.json()['id']
    assert api(client, 'GET', f'/posts/{pid}', bh).status_code == 404
    assert api(client, 'PATCH', f'/posts/{pid}', bh, {'content':'stolen'}).status_code == 404
    assert api(client, 'DELETE', f'/posts/{pid}', bh).status_code == 404
    assert api(client, 'POST', f'/profiles/{a}/follow', bh).status_code == 200
    assert api(client, 'GET', f'/posts/{pid}', bh).status_code == 200
    assert api(client, 'GET', '/feed?mode=following', bh).json()['items'][0]['id'] == pid
    assert api(client, 'GET', '/hashtags/fastapi', bh).json()['count'] == 1
    assert api(client, 'GET', '/hashtags/fastapi', ch).json()['count'] == 0
    assert not api(client, 'GET', '/search?q=Hello', ch).json()['posts']
    assert not api(client, 'GET', '/search?q=FastAPI', ch).json()['topics']
    assert api(client, 'GET', '/search?q=FastAPI', bh).json()['topics'] == [{'name':'fastapi', 'posts':1}]
    assert api(client, 'POST', f'/posts/{pid}/reaction', ch, {'emoji':'❤️'}).status_code == 404
    assert client.post(f'/api/users/{b}/block', headers=ah).status_code == 200
    assert api(client, 'GET', f'/posts/{pid}', bh).status_code == 404
    assert api(client, 'POST', f'/profiles/{a}/follow', bh).status_code == 404
    assert api(client, 'GET', f'/profiles/{a}', bh).status_code == 404
    assert api(client, 'GET', f'/profiles/{a}', ah).status_code == 200


def test_interactions_poll_notifications_and_chat_sharing():
    client = TestClient(app)
    a, ah = account(client, 'social_diana')
    b, bh = account(client, 'social_erin')
    created = api(client, 'POST', '/posts', ah, {'content':'Choose #Backend', 'poll_options':['FastAPI','Flask']})
    assert created.status_code == 201, created.text
    pid = created.json()['id']
    oid = created.json()['poll'][0]['id']
    assert api(client, 'POST', f'/posts/{pid}/vote', bh, {'option_id':oid}).status_code == 200
    assert api(client, 'POST', f'/posts/{pid}/vote', bh, {'option_id':oid}).status_code == 409
    assert api(client, 'POST', f'/posts/{pid}/reaction', bh, {'emoji':'❤️'}).status_code == 200
    assert api(client, 'POST', f'/posts/{pid}/reaction', bh, {'emoji':'👍'}).json()['likes_count'] == 1
    assert api(client, 'POST', f'/posts/{pid}/bookmark', bh, {}).json()['bookmarked'] is True
    assert api(client, 'POST', f'/posts/{pid}/bookmark', bh, {}).status_code == 200
    assert len(api(client, 'GET', '/bookmarks', bh).json()['items']) == 1
    comment = api(client, 'POST', f'/posts/{pid}/comments', bh, {'content':'Good idea'})
    assert comment.status_code == 201, comment.text
    cid = comment.json()['id']
    assert api(client, 'POST', f'/posts/{pid}/comments', ah, {'content':'Thanks', 'parent_id':cid}).status_code == 201
    assert api(client, 'GET', f'/posts/{pid}/comments', bh).json()['items'][1]['parent_id'] == cid
    assert api(client, 'DELETE', f'/comments/{cid}', ah).status_code == 403
    assert api(client, 'POST', f'/posts/{pid}/repost', bh).status_code == 201
    assert api(client, 'POST', f'/posts/{pid}/repost', bh).status_code == 201
    assert api(client, 'POST', '/posts', bh, {'content':'My take', 'quote_of_id':pid}).status_code == 201
    notifications = api(client, 'GET', '/notifications', ah).json()
    assert {'like','comment','repost','quote'} <= {n['type'] for n in notifications['items']}
    assert api(client, 'POST', '/notifications/read', ah, {}).json()['updated'] >= 4
    conv = client.post('/api/conversations/direct', headers=bh, json={'recipient_id':a}).json()
    share = api(client, 'POST', f'/posts/{pid}/share-to-chat', bh, {'conversation_id':conv['id']})
    assert share.status_code == 200, share.text
    assert f"/app/posts/{created.json()['public_id']}" in share.json()['content']
    assert any(n['type'] == 'message' for n in api(client, 'GET', '/notifications', ah).json()['items'])
    assert api(client, 'GET', '/trending', bh).status_code == 200


def test_idempotent_offline_post_and_collaboration_lifecycle():
    client = TestClient(app)
    owner, oh = account(client, 'collab_owner')
    friend, fh = account(client, 'collab_friend')
    third, th = account(client, 'collab_third')
    key = '12345678-1234-4234-8234-123456789abc'
    payload = {'content': 'One shared post', 'client_id': key, 'collaborator_ids': [friend]}
    first = api(client, 'POST', '/posts', oh, payload)
    assert first.status_code == 201, first.text
    pid = first.json()['id']
    assert api(client, 'POST', '/posts', oh, payload).json()['id'] == pid
    assert api(client, 'POST', '/posts', oh, {**payload, 'content': 'Changed'}).status_code == 409
    assert api(client, 'POST', '/posts', th, {**payload, 'collaborator_ids': []}).json()['id'] != pid
    assert api(client, 'GET', f'/profiles/{friend}/posts', fh).json()['items'] == []
    assert api(client, 'GET', '/collaborations/invitations', fh).json()['items'][0]['post_id'] == pid
    assert api(client, 'GET', f'/collaborations/invitations/{pid}', th).status_code == 404
    assert api(client, 'POST', f'/posts/{pid}/collaborators/respond?accept=true', th).status_code == 404
    assert api(client, 'POST', f'/posts/{pid}/collaborators/respond?accept=true', fh).status_code == 200
    shared = api(client, 'GET', f'/profiles/{friend}/posts', fh).json()['items']
    assert [item['id'] for item in shared] == [pid]
    assert shared[0]['collaborators'][0]['id'] == friend
    assert api(client, 'POST', f'/profiles/{owner}/follow', th).status_code == 200
    assert api(client, 'POST', f'/profiles/{friend}/follow', th).status_code == 200
    assert [p['id'] for p in api(client, 'GET', '/feed?mode=following', th).json()['items']].count(pid) == 1
    assert api(client, 'PATCH', f'/posts/{pid}', fh, {'content': 'No'}).status_code == 403
    assert api(client, 'DELETE', f'/posts/{pid}', fh).status_code == 403
    assert api(client, 'POST', f'/posts/{pid}/reaction', th, {'emoji': '❤️'}).json()['likes_count'] == 1
    assert api(client, 'GET', f'/profiles/{friend}/posts', fh).json()['items'][0]['likes_count'] == 1
    assert api(client, 'DELETE', f'/posts/{pid}/collaborators/{friend}', th).status_code == 403
    assert api(client, 'DELETE', f'/posts/{pid}/collaborators/{friend}', fh).status_code == 200
    assert api(client, 'GET', f'/profiles/{friend}/posts', fh).json()['items'] == []
    assert api(client, 'POST', f'/posts/{pid}/collaborators/{friend}', oh).status_code == 200
    assert api(client, 'POST', f'/posts/{pid}/collaborators/respond?accept=false', fh).status_code == 200
    assert api(client, 'POST', f'/posts/{pid}/collaborators/{friend}', oh).status_code == 200
    assert api(client, 'DELETE', f'/posts/{pid}/collaborators/{friend}', oh).status_code == 200
    assert api(client, 'POST', f'/posts/{pid}/collaborators/respond?accept=true', fh).status_code == 404
    assert api(client, 'DELETE', f'/posts/{pid}', oh).status_code == 200
    assert api(client, 'GET', f'/posts/{pid}', oh).status_code == 404


def test_offline_media_key_validation_and_invitation_atomicity(tmp_path, monkeypatch):
    from app.routes import post_media
    monkeypatch.setattr(post_media, 'POST_MEDIA_DIR', tmp_path)
    client = TestClient(app)
    owner, oh = account(client, 'offline_owner')
    friend, fh = account(client, 'offline_friend')
    key = '87654321-1234-4234-8234-123456789abc'
    uploaded = client.post('/api/social/post-media', headers=oh,
        files={'file': ('offline.png', b'\x89PNG\r\n\x1a\nexample', 'image/png')})
    assert uploaded.status_code == 201, uploaded.text
    media = {'content': 'Offline photo', 'media_url': uploaded.json()['file_url'],
             'media_type': 'IMAGE', 'client_id': key, 'collaborator_ids': [friend]}
    assert api(client, 'POST', '/posts', {}, media).status_code != 201
    assert api(client, 'POST', '/posts', oh, {**media, 'media_url': '/uploads/unsafe.svg'}).status_code == 400
    assert api(client, 'POST', '/posts', oh, {**media, 'collaborator_ids': [999999]}).status_code == 404
    assert api(client, 'GET', '/collaborations/invitations', fh).json()['items'] == []
    first = api(client, 'POST', '/posts', oh, media)
    assert first.status_code == 201, first.text
    assert first.json()['media_url'] == uploaded.json()['file_url']
    assert api(client, 'POST', '/posts', oh, media).json()['id'] == first.json()['id']
    assert len(api(client, 'GET', '/collaborations/invitations', fh).json()['items']) == 1


def test_post_idempotency_schema_migrates_existing_sqlite(monkeypatch):
    from sqlalchemy import create_engine, inspect
    from app import main
    engine = create_engine('sqlite:///:memory:')
    with engine.begin() as conn:
        conn.exec_driver_sql('CREATE TABLE posts (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL)')
        conn.exec_driver_sql('INSERT INTO posts (id, author_id) VALUES (2, 1)')
    monkeypatch.setattr(main, 'engine', engine)
    main.run_schema_migrations()
    with engine.begin() as conn:
        old_public_id = conn.exec_driver_sql('SELECT public_id FROM posts WHERE id = 2').scalar()
    main.run_schema_migrations()
    with engine.begin() as conn:
        assert conn.exec_driver_sql('SELECT public_id FROM posts WHERE id = 2').scalar() == old_public_id
    assert old_public_id and len(old_public_id) == 32
    columns = {column['name'] for column in inspect(engine).get_columns('posts')}
    assert {'client_id', 'request_fingerprint', 'public_id'} <= columns
    with engine.begin() as conn:
        conn.exec_driver_sql("INSERT INTO posts (author_id, client_id) VALUES (1, 'same')")
        import pytest
        with pytest.raises(Exception):
            conn.exec_driver_sql("INSERT INTO posts (author_id, client_id) VALUES (1, 'same')")


def test_private_creator_collaboration_stays_private():
    client = TestClient(app)
    owner, oh = account(client, 'private_collab_owner')
    friend, fh = account(client, 'private_collab_friend')
    _, th = account(client, 'private_collab_viewer')
    from conftest import TestingSessionLocal
    from app.models.user import User
    with TestingSessionLocal() as db:
        db.get(User, owner).is_private = True
        db.commit()
    created = api(client, 'POST', '/posts', oh, {'content': 'Private shared', 'collaborator_ids': [friend]})
    assert created.status_code == 201, created.text
    pid = created.json()['id']
    assert api(client, 'POST', f'/posts/{pid}/collaborators/respond?accept=true', fh).status_code == 200
    assert api(client, 'GET', f'/posts/{pid}', fh).status_code == 200
    assert api(client, 'GET', f'/posts/{pid}', th).status_code == 404
    assert api(client, 'GET', f'/profiles/{friend}/posts', th).json()['items'] == []


def test_hashtag_totals_are_visible_and_trending_keeps_all_time_count():
    from datetime import datetime, timedelta, timezone
    from app.models.social import Post
    from conftest import TestingSessionLocal

    client = TestClient(app)
    _, ah = account(client, 'social_topic_author')
    _, bh = account(client, 'social_topic_viewer')
    old = api(client, 'POST', '/posts', ah, {'content': 'Old #RelayTopic'})
    assert old.status_code == 201, old.text
    assert api(client, 'POST', '/posts', ah, {'content': 'New #RelayTopic'}).status_code == 201
    assert api(client, 'POST', '/posts', ah,
               {'content': 'Private #RelayTopic', 'visibility': 'FOLLOWERS'}).status_code == 201
    with TestingSessionLocal() as db:
        post = db.get(Post, old.json()['id'])
        post.created_at = datetime.now(timezone.utc) - timedelta(days=3)
        db.commit()
    assert api(client, 'GET', '/search?q=RelayTopic', bh).json()['topics'] == [
        {'name': 'relaytopic', 'posts': 2}]
    topic = next(row for row in api(client, 'GET', '/trending', bh).json()
                 if row['name'] == 'relaytopic')
    assert topic['posts'] == 2 and topic['recent_posts'] == 1


def test_community_roles_posts_and_story_privacy():
    client = TestClient(app)
    owner, oh = account(client, 'social_frank')
    member, mh = account(client, 'social_grace')
    other, xh = account(client, 'social_henry')
    community = api(client, 'POST', '/communities', oh, {'name':'Builders', 'description':'Build together'})
    assert community.status_code == 201, community.text
    cid = community.json()['id']
    assert api(client, 'POST', '/posts', mh, {'content':'No access', 'community_id':cid}).status_code == 403
    joined = api(client, 'POST', f'/communities/{cid}/join', mh)
    assert joined.status_code == 200 and joined.json()['conversation_id']
    chat_id = joined.json()['conversation_id']
    assert client.post(f'/api/groups/{chat_id}/members', headers=oh,
        json={'user_id':other}).status_code == 403
    assert client.post(f'/api/groups/{chat_id}/leave', headers=mh).status_code == 403
    assert api(client, 'PATCH', f'/communities/{cid}/members/{member}', mh, {'role':'MODERATOR'}).status_code == 403
    post = api(client, 'POST', '/posts', mh, {'content':'Community hello', 'community_id':cid})
    assert post.status_code == 201, post.text
    pid = post.json()['id']
    assert api(client, 'POST', f'/communities/{cid}/posts/{pid}/pin', mh).status_code == 403
    assert api(client, 'PATCH', f'/communities/{cid}/members/{member}', oh, {'role':'MODERATOR'}).status_code == 200
    assert api(client, 'POST', f'/communities/{cid}/posts/{pid}/pin', mh).status_code == 200
    assert api(client, 'DELETE', f'/communities/{cid}/posts/{pid}', mh).status_code == 200
    assert api(client, 'GET', f'/posts/{pid}', xh).status_code == 404
    story = client.post('/api/stories', headers=oh, json={
        'media_url':'', 'media_type':'TEXT', 'caption':'Private thought', 'visibility':'FOLLOWERS'}).json()
    assert story['visibility'] == 'FOLLOWERS'
    assert client.post(f"/api/stories/{story['id']}/view", headers=xh).status_code == 404
    assert not any(g['user_id'] == owner for g in client.get('/api/stories', headers=xh).json())
    assert api(client, 'POST', f'/profiles/{owner}/follow', mh).status_code == 200
    assert any(g['user_id'] == owner for g in client.get('/api/stories', headers=mh).json())


def test_reply_policy_reporting_and_upload_validation(tmp_path, monkeypatch):
    from app.config import settings
    from app.services import cloudinary_service
    monkeypatch.setattr(settings, 'UPLOAD_DIR', str(tmp_path))
    monkeypatch.setattr(cloudinary_service, 'cloudinary_configured', False)
    client = TestClient(app)
    a, ah = account(client, 'social_iris')
    b, bh = account(client, 'social_jules')
    bad_upload = client.post('/api/uploads', headers=ah,
        files={'file':('unsafe.svg', b'<svg onload="alert(1)"></svg>', 'image/svg+xml')})
    assert bad_upload.status_code == 400
    assert not list(tmp_path.iterdir())
    assert api(client, 'POST', '/posts', ah, {'content':'x', 'media_url':'javascript:alert(1)',
        'media_type':'IMAGE'}).status_code == 400
    created = api(client, 'POST', '/posts', ah, {'content':'Read only', 'reply_policy':'FOLLOWERS'})
    pid = created.json()['id']
    assert api(client, 'POST', f'/posts/{pid}/comments', bh, {'content':'Hello'}).status_code == 403
    assert api(client, 'POST', f'/profiles/{a}/follow', bh).status_code == 200
    assert api(client, 'POST', f'/posts/{pid}/comments', bh, {'content':'Hello'}).status_code == 201
    body = {'entity_type':'post', 'entity_id':pid, 'reason':'spam'}
    assert api(client, 'POST', '/reports', bh, body).status_code == 201
    assert api(client, 'POST', '/reports', bh, body).status_code == 201
    assert api(client, 'GET', f'/posts/{pid}', bh).status_code == 200
