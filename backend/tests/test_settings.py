from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.main import app


def register(client: TestClient, name: str):
    response = client.post('/api/auth/register', json={
        'username': name, 'email': f'{name}@example.com', 'password': 'password123',
        'confirm_password': 'password123', 'display_name': name.title(),
    })
    assert response.status_code == 201
    data = response.json()
    return data['user']['id'], {'Authorization': f"Bearer {data['access_token']}"}


def test_settings_persist_validate_and_restrict_direct_messages():
    with TestClient(app) as client:
        sender_id, sender = register(client, 'settings_sender')
        target_id, target = register(client, 'settings_target')
        defaults = client.get('/api/settings', headers=target)
        assert defaults.status_code == 200
        assert defaults.json()['dm_policy'] == 'EVERYONE'
        update = client.patch('/api/settings', headers=target, json={
            'dm_policy': 'NOBODY', 'chat_text_size': 'LARGE', 'auto_download_images': False,
        })
        assert update.status_code == 200
        assert client.get('/api/settings', headers=target).json()['chat_text_size'] == 'LARGE'
        assert client.post('/api/conversations/direct', headers=sender, json={'recipient_id': target_id}).status_code == 403
        assert client.patch('/api/settings', headers=target, json={'dm_policy': None}).status_code == 400
        assert client.patch('/api/settings', headers=target, json={'dm_policy': 'WRONG'}).status_code == 422
        assert client.patch('/api/settings', headers=target, json={
            'dnd_until': (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        }).status_code == 200
        assert client.patch('/api/settings', headers=target, json={'dnd_until': None}).status_code == 200
        assert client.patch('/api/settings', headers=target, json={'dm_policy': 'EVERYONE'}).status_code == 200
        assert client.post('/api/conversations/direct', headers=sender, json={'recipient_id': target_id}).status_code == 201


def test_contact_change_and_export_scope():
    with TestClient(app) as client:
        user_id, auth = register(client, 'settings_exporter')
        other_id, other = register(client, 'settings_other')
        assert client.post('/api/settings/username', headers=auth, json={
            'username': 'settings_exporter2', 'current_password': 'wrong',
        }).status_code == 403
        assert client.post('/api/settings/username', headers=auth, json={
            'username': 'settings_exporter2', 'current_password': 'password123',
        }).status_code == 200
        export = client.get('/api/settings/export', headers=auth)
        assert export.status_code == 200
        assert export.headers['cache-control'] == 'no-store'
        assert export.json()['account']['id'] == user_id
        assert export.json()['account']['email'] != 'settings_other@example.com'
        assert other_id not in export.json()['conversation_ids']
        assert client.post('/api/settings/feedback', headers=auth, json={
            'kind': 'BUG', 'message': 'A reproducible test issue',
        }).status_code == 201


def test_contact_verification_and_cookie_origin_protection():
    with TestClient(app) as client:
        _, auth = register(client, 'settings_contact')
        blocked = client.patch('/api/settings', headers={'Origin': 'https://untrusted.example'}, json={'density': 'COMPACT'})
        assert blocked.status_code == 403
        start = client.post('/api/settings/contact-change', headers=auth, json={
            'kind': 'phone', 'value': '+14155552671', 'current_password': 'password123',
        })
        assert start.status_code == 200
        contact_code = start.json()['demo_code']
        assert len(contact_code) == 6
        assert client.post('/api/settings/contact-change/verify', headers=auth, json={
            'kind': 'phone', 'code': '999999',
        }).status_code == 400
        verify = client.post('/api/settings/contact-change/verify', headers=auth, json={
            'kind': 'phone', 'code': contact_code,
        })
        assert verify.status_code == 200
        assert verify.json()['phone_number'] == '+14155552671'


def test_revoked_session_closes_active_websocket():
    with TestClient(app) as client:
        user_id, auth = register(client, 'settings_socket')
        sessions = client.get('/api/auth/sessions', headers=auth).json()
        current = next(row for row in sessions if row['is_current'])
        with client.websocket_connect('/ws', headers={'Origin': 'http://testserver', **auth}) as websocket:
            assert client.delete(f"/api/auth/sessions/{current['session_id']}", headers=auth).status_code == 200
            from starlette.websockets import WebSocketDisconnect
            try:
                websocket.receive_json()
                assert False, 'revoked socket remained open'
            except WebSocketDisconnect as error:
                assert error.code == 1008
