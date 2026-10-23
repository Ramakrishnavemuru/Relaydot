from fastapi.testclient import TestClient

from app.main import app


def register(client: TestClient, name: str):
    result = client.post('/api/auth/register', json={
        'username': name, 'email': f'{name}@example.com',
        'password': 'password123', 'confirm_password': 'password123'})
    assert result.status_code == 201, result.text
    body = result.json()
    return body['user']['id'], {'Authorization': f"Bearer {body['access_token']}"}


def test_conversation_preferences_and_pin_are_per_member():
    with TestClient(app) as client:
        alice, ah = register(client, 'chat_manage_alice')
        bob, bh = register(client, 'chat_manage_bob')
        conv_id = client.post('/api/conversations/direct', headers=ah,
                              json={'recipient_id': bob}).json()['id']
        first = client.post('/api/messages', headers=bh,
                            json={'conversation_id': conv_id, 'content': 'Private hello'}).json()
        prefs = client.patch(f'/api/conversations/{conv_id}/preferences', headers=ah,
                             json={'is_pinned': True, 'is_favourite': True,
                                   'is_archived': True, 'mute_messages': True,
                                   'mute_calls': True})
        assert prefs.status_code == 200, prefs.text
        alice_row = client.get('/api/conversations', headers=ah).json()[0]
        assert all(alice_row[key] for key in (
            'is_pinned', 'is_favourite', 'is_archived', 'is_muted', 'mute_calls'))
        bob_row = client.get('/api/conversations', headers=bh).json()[0]
        assert not any(bob_row[key] for key in (
            'is_pinned', 'is_favourite', 'is_archived', 'is_muted', 'mute_calls'))

        assert client.post(f'/api/conversations/{conv_id}/lock', headers=ah,
                           json={'pin': '12a4'}).status_code == 422
        locked = client.post(f'/api/conversations/{conv_id}/lock', headers=ah,
                             json={'pin': '1234'})
        assert locked.status_code == 200, locked.text
        alice_row = client.get('/api/conversations', headers=ah).json()[0]
        assert alice_row['is_locked'] and not alice_row['is_unlocked']
        assert alice_row['last_message'] is None and alice_row['other_user'] is None
        assert client.get(f'/api/messages/conversation/{conv_id}', headers=ah).status_code == 423
        assert client.get(f"/api/messages/{first['id']}", headers=ah).status_code == 423
        assert client.get('/api/search/messages', headers=ah,
                          params={'q': 'Private'}).json() == []
        assert client.get(f'/api/messages/conversation/{conv_id}', headers=bh).status_code == 200
        assert client.post(f'/api/conversations/{conv_id}/unlock', headers=ah,
                           json={'pin': '9999'}).status_code == 403
        unlocked = client.post(f'/api/conversations/{conv_id}/unlock', headers=ah,
                               json={'pin': '1234'})
        assert unlocked.status_code == 200, unlocked.text
        assert any('Max-Age=900' in cookie and 'Path=/' in cookie
                   for cookie in unlocked.headers.get_list('set-cookie'))
        assert client.get(f'/api/messages/conversation/{conv_id}', headers=ah).json()[0]['id'] == first['id']
        assert client.post(f'/api/conversations/{conv_id}/relock', headers=ah).status_code == 200
        assert client.get(f'/api/messages/conversation/{conv_id}', headers=ah).status_code == 423
        assert client.request('DELETE', f'/api/conversations/{conv_id}/lock', headers=ah,
                              json={'pin': '1234'}).status_code == 200

        assert client.post(f'/api/conversations/{conv_id}/clear', headers=ah).status_code == 200
        assert client.get(f'/api/messages/conversation/{conv_id}', headers=ah).json() == []
        assert len(client.get(f'/api/messages/conversation/{conv_id}', headers=bh).json()) == 1
        assert client.delete(f'/api/conversations/{conv_id}', headers=ah).status_code == 200
        assert client.get('/api/conversations', headers=ah).json() == []
        client.post('/api/messages', headers=bh,
                    json={'conversation_id': conv_id, 'content': 'A fresh message'})
        rows = client.get('/api/conversations', headers=ah).json()
        assert len(rows) == 1 and rows[0]['last_message']['content'] == 'A fresh message'
