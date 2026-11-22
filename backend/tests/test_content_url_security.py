"""Object access through opaque and legacy URLs, including private media."""
from conftest import BrowserTestClient as TestClient

from app.main import app
from app.models.user import User
from app.models.reel import Reel
from app.routes import post_media
from conftest import TestingSessionLocal


def account(client, name):
    response = client.post('/api/auth/register', json={
        'username': name, 'email': f'{name}@example.com',
        'password': 'password123', 'confirm_password': 'password123'})
    assert response.status_code == 201, response.text
    body = response.json()
    return body['user']['id'], {'Authorization': f"Bearer {body['access_token']}"}


def private_account(user_id):
    with TestingSessionLocal() as db:
        db.get(User, user_id).is_private = True
        db.commit()


def test_post_opaque_url_legacy_url_and_private_access():
    client = TestClient(app)
    owner, own = account(client, 'url_owner')
    follower, follow = account(client, 'url_follower')
    _, stranger = account(client, 'url_stranger')
    private_account(owner)
    created = client.post('/api/social/posts', headers=own, json={
        'content': 'private caption', 'visibility': 'EVERYONE'})
    assert created.status_code == 201, created.text
    post = created.json()
    assert len(post['public_id']) == 32
    opaque = f"/api/social/posts/public/{post['public_id']}"
    legacy = f"/api/social/posts/{post['id']}"
    for headers in (stranger, follow):
        assert client.get(opaque, headers=headers).status_code == 404
        assert client.get(legacy, headers=headers).status_code == 404
        assert client.get(f"{legacy}/comments", headers=headers).status_code == 404
        assert client.patch(legacy, headers=headers, json={'content': 'stolen'}).status_code == 404
        assert client.delete(legacy, headers=headers).status_code == 404
    assert client.get(opaque, headers=own).json()['content'] == 'private caption'
    assert client.post(f'/api/social/profiles/{owner}/follow', headers=follow).status_code == 403
    assert client.get(opaque, headers=follow).status_code == 404
    # Private accounts need an approved follower relationship.
    with TestingSessionLocal() as db:
        from app.models.social import Follow
        db.add(Follow(follower_id=follower, following_id=owner))
        db.commit()
    assert client.get(opaque, headers=follow).status_code == 200
    assert client.get(legacy, headers=follow).status_code == 200
    assert client.get(opaque, headers=stranger).status_code == 404
    assert client.post(f'/api/users/{follower}/block', headers=own).status_code == 200
    assert client.get(opaque, headers=follow).status_code == 404
    assert client.delete(legacy, headers=own).status_code == 200
    assert client.get(opaque, headers=own).status_code == 404


def test_private_post_media_requires_current_visibility(tmp_path, monkeypatch):
    monkeypatch.setattr(post_media, 'POST_MEDIA_DIR', tmp_path)
    client = TestClient(app)
    owner, own = account(client, 'media_owner')
    follower, follow = account(client, 'media_follower')
    _, stranger = account(client, 'media_stranger')
    private_account(owner)
    assert client.post('/api/social/posts', headers=own, json={
        'content': 'unsafe public media', 'media_url': '/uploads/known.png',
        'media_type': 'IMAGE'}).status_code == 400
    uploaded = client.post('/api/social/post-media', headers=own,
        files={'file': ('photo.png', b'\x89PNG\r\n\x1a\n' + b'example', 'image/png')})
    assert uploaded.status_code == 201, uploaded.text
    url = uploaded.json()['file_url']
    assert client.get(url, headers=own).status_code == 200
    assert client.get(url, headers=stranger).status_code == 404
    assert client.get(url).status_code in (401, 403, 404)
    assert client.post('/api/social/posts', headers=stranger, json={
        'content': 'stolen', 'media_url': url, 'media_type': 'IMAGE'}).status_code == 404
    created = client.post('/api/social/posts', headers=own, json={
        'content': 'private photo', 'media_url': url, 'media_type': 'IMAGE'})
    assert created.status_code == 201, created.text
    assert client.get(url, headers=stranger).status_code == 404
    with TestingSessionLocal() as db:
        from app.models.social import Follow
        db.add(Follow(follower_id=follower, following_id=owner))
        db.commit()
    assert client.get(url, headers=follow).status_code == 200
    assert client.delete(f"/api/social/posts/{created.json()['id']}", headers=own).status_code == 200
    assert client.get(url, headers=follow).status_code == 404


def test_reel_direct_access_and_insights_are_private():
    client = TestClient(app)
    owner, own = account(client, 'direct_reel_owner')
    follower, follow = account(client, 'direct_reel_follow')
    _, stranger = account(client, 'direct_reel_stranger')
    private_account(owner)
    key = '1' * 32
    with TestingSessionLocal() as db:
        db.add(Reel(public_id=key, creator_id=owner, caption='private reel',
                    source_path='/not/a/public/file', status='PUBLISHED', visibility='EVERYONE'))
        db.commit()
    url = f'/api/reels/{key}'
    assert client.get(url, headers=own).status_code == 200
    assert client.get(url, headers=stranger).status_code == 404
    assert client.get(f'{url}/analytics', headers=stranger).status_code == 404
    assert client.post(f'{url}/like', headers=stranger).status_code == 404
    with TestingSessionLocal() as db:
        from app.models.social import Follow
        db.add(Follow(follower_id=follower, following_id=owner))
        db.commit()
    assert client.get(url, headers=follow).status_code == 200
    assert client.get(f'{url}/analytics', headers=follow).status_code == 404
    with TestingSessionLocal() as db:
        db.query(Reel).filter_by(public_id=key).update({'status': 'ARCHIVED'})
        db.commit()
    assert client.get(url, headers=follow).status_code == 404
    assert client.post(f'{url}/like', headers=own).status_code == 404


def test_legacy_local_post_file_is_not_public(tmp_path, monkeypatch):
    from app import main
    monkeypatch.setattr(main, 'SessionLocal', TestingSessionLocal)
    mount = next(route for route in app.routes if getattr(route, 'path', None) == '/uploads')
    monkeypatch.setattr(mount.app, 'directory', str(tmp_path))
    monkeypatch.setattr(mount.app, 'all_directories', [str(tmp_path)])
    (tmp_path / 'legacy.png').write_bytes(b'\x89PNG\r\n\x1a\nexample')
    client = TestClient(app)
    owner, own = account(client, 'legacy_owner')
    _, stranger = account(client, 'legacy_stranger')
    private_account(owner)
    # Simulate an existing post that predates the private uploader.
    with TestingSessionLocal() as db:
        from app.models.social import Post
        db.add(Post(author_id=owner, content='private legacy media',
                    media_url='/uploads/legacy.png', media_type='IMAGE'))
        db.commit()
    assert client.get('/uploads/legacy.png', headers=own).status_code == 200
    denied = client.get('/uploads/legacy.png', headers=stranger)
    assert denied.status_code == 404
    assert b'example' not in denied.content


def test_private_collaborator_can_view_but_cannot_edit():
    client = TestClient(app)
    owner, own = account(client, 'collab_url_owner')
    collaborator, invited = account(client, 'collab_url_invited')
    _, stranger = account(client, 'collab_url_stranger')
    private_account(owner)
    response = client.post('/api/social/posts', headers=own, json={
        'content': 'shared private draft', 'collaborator_ids': [collaborator]})
    assert response.status_code == 201, response.text
    post = response.json()
    url = f"/api/social/posts/public/{post['public_id']}"
    assert client.get(url, headers=invited).status_code == 404
    assert client.post(f"/api/social/posts/{post['id']}/collaborators/respond?accept=true",
                       headers=invited).status_code == 200
    assert client.get(url, headers=invited).status_code == 200
    assert client.get(url, headers=stranger).status_code == 404
    assert client.patch(f"/api/social/posts/{post['id']}", headers=invited,
                        json={'content': 'unauthorized edit'}).status_code == 403
