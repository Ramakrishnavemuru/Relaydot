from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.main import app
from app.models.reel import Reel
from conftest import TestingSessionLocal


def account(client: TestClient, name: str):
    response = client.post('/api/auth/register', json={
        'username': name, 'email': f'{name}@example.com',
        'password': 'password123', 'confirm_password': 'password123'})
    assert response.status_code == 201, response.text
    body = response.json()
    return body['user']['id'], {'Authorization': f"Bearer {body['access_token']}"}


def test_profile_connections_and_private_account_visibility():
    with TestClient(app) as client:
        owner, owner_headers = account(client, 'privacy_owner')
        viewer, viewer_headers = account(client, 'privacy_viewer')
        mutual, mutual_headers = account(client, 'privacy_mutual')
        post = client.post('/api/social/posts', headers=owner_headers,
                           json={'content': 'Public post'}).json()
        with TestingSessionLocal() as db:
            db.add(Reel(public_id='privacy-reel', creator_id=owner,
                        caption='Public Reel', source_path='test.mp4', status='PUBLISHED',
                        visibility='EVERYONE', published_at=datetime.now(timezone.utc)))
            db.commit()

        assert client.post(f'/api/social/profiles/{mutual}/follow', headers=viewer_headers).status_code == 200
        assert client.post(f'/api/social/profiles/{owner}/follow', headers=mutual_headers).status_code == 200
        assert client.post(f'/api/social/profiles/{mutual}/follow', headers=owner_headers).status_code == 200
        public = client.get(f'/api/social/profiles/{owner}', headers=viewer_headers).json()
        assert public['posts_count'] == 2 and public['reels_count'] == 1
        assert public['followers_count'] == 1 and public['following_count'] == 1
        assert public['mutuals_count'] == 1
        assert client.get(f'/api/social/profiles/{owner}/mutuals', headers=viewer_headers).json()['items'][0]['id'] == mutual
        assert client.get(f'/api/social/profiles/{owner}/followers', headers=viewer_headers).json()['items'][0]['id'] == mutual
        assert client.get(f'/api/social/profiles/{owner}/following', headers=viewer_headers).json()['items'][0]['id'] == mutual
        assert client.get('/api/reels?creator_id=' + str(owner), headers=viewer_headers).json()['items'][0]['public_id'] == 'privacy-reel'

        changed = client.put('/api/users/privacy', headers=owner_headers, json={'is_private': True})
        assert changed.status_code == 200 and changed.json()['is_private'] is True
        private = client.get(f'/api/social/profiles/{owner}', headers=viewer_headers).json()
        assert private['is_private'] is True
        assert private['posts_count'] == private['reels_count'] == 0
        assert private['followers_count'] == private['following_count'] == private['mutuals_count'] == 0
        assert client.get(f'/api/social/profiles/{owner}', headers=owner_headers).json()['posts_count'] == 2
        for list_name in ('followers', 'following', 'mutuals', 'posts'):
            assert client.get(f'/api/social/profiles/{owner}/{list_name}', headers=viewer_headers).status_code == 403
        assert client.get(f"/api/social/posts/{post['id']}", headers=viewer_headers).status_code == 404
        assert client.get('/api/social/feed', headers=viewer_headers).json()['items'] == []
        assert client.get('/api/reels?creator_id=' + str(owner), headers=viewer_headers).json()['items'] == []
        assert client.get('/api/reels/privacy-reel', headers=viewer_headers).status_code == 404
        assert client.post(f'/api/social/profiles/{owner}/follow', headers=viewer_headers).status_code == 403
        assert client.get('/api/reels?creator_id=' + str(owner), headers=owner_headers).json()['items'][0]['public_id'] == 'privacy-reel'

        assert client.put('/api/users/privacy', headers=owner_headers,
                          json={'is_private': False}).status_code == 200
        assert client.get(f'/api/social/profiles/{owner}', headers=viewer_headers).json()['posts_count'] == 2
