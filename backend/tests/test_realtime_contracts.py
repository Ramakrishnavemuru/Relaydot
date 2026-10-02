"""Exercise the contracts used by the redesigned live UI, with an isolated DB."""
import base64
from pathlib import Path

from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.services import cloudinary_service


def account(client, name):
    response = client.post('/api/auth/register', json={
        'username': name, 'email': f'{name}@example.com',
        'password': 'review-password', 'confirm_password': 'review-password',
    })
    assert response.status_code == 201
    data = response.json()
    return data, {'Authorization': f"Bearer {data['access_token']}"}


def receive(socket, event):
    for _ in range(12):
        payload = socket.receive_json()
        if payload['event'] == event:
            return payload['data']
    raise AssertionError(f'Missing socket event: {event}')


def test_rest_ack_socket_echo_receipts_and_reconnect():
    with TestClient(app) as client:
        alice, headers_a = account(client, 'realtime_alice')
        bob, headers_b = account(client, 'realtime_bob')
        conv = client.post('/api/conversations/direct', headers=headers_a, json={'recipient_id':bob['user']['id']}).json()
        with client.websocket_connect(f"/ws?token={alice['access_token']}") as ws_a:
            with client.websocket_connect(f"/ws?token={bob['access_token']}") as ws_b:
                sent = client.post('/api/messages', headers=headers_a, json={'conversation_id':conv['id'],'content':'A real message ✨\nhttps://example.com/brief'}).json()
                assert receive(ws_a, 'message')['id'] == sent['id']
                assert receive(ws_b, 'message')['id'] == sent['id']
                ws_b.send_json({'event':'typing_start','data':{'conversation_id':conv['id']}})
                assert receive(ws_a,'typing_start')['user_id'] == bob['user']['id']
                ws_b.send_json({'event':'read','data':{'conversation_id':conv['id']}})
                receipt = receive(ws_a,'read')
                assert receipt['message_ids'] == [sent['id']]
                history = client.get(f"/api/messages/conversation/{conv['id']}",headers=headers_a).json()
                assert history[0]['status'] == 'READ'
                edited = client.put(f"/api/messages/{sent['id']}",headers=headers_a,json={'content':'Updated brief'}).json()
                assert receive(ws_b,'message_edit')['content'] == edited['content']
                assert receive(ws_a,'message_edit')['id'] == sent['id']
                client.post(f"/api/messages/{sent['id']}/reaction",headers=headers_b,json={'emoji':'👍'})
                assert receive(ws_a,'reaction')['message_id'] == sent['id']
            with client.websocket_connect(f"/ws?token={bob['access_token']}") as reconnected:
                reconnected.send_json({'event':'message','data':{'conversation_id':conv['id'],'content':'Back online','reply_to_id':sent['id']}})
                reply = receive(ws_a,'message')
                assert reply['reply_to']['id'] == sent['id']
                assert receive(reconnected,'message')['id'] == reply['id']
                client.delete(f"/api/messages/{sent['id']}",headers=headers_a)
                assert receive(reconnected,'message_delete')['id'] == sent['id']

def test_pagination_search_and_shared_uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(settings,'UPLOAD_DIR',str(tmp_path))
    monkeypatch.setattr(cloudinary_service,'cloudinary_configured',False)
    client = TestClient(app)
    alice, headers = account(client,'pagination_alice')
    bob, _ = account(client,'pagination_bob')
    conv = client.post('/api/conversations/direct',headers=headers,json={'recipient_id':bob['user']['id']}).json()
    for i in range(55):
        assert client.post('/api/messages',headers=headers,json={'conversation_id':conv['id'],'content':f'History item {i}'}).status_code == 201
    latest = client.get(f"/api/messages/conversation/{conv['id']}",headers=headers,params={'limit':50}).json()
    earlier = client.get(f"/api/messages/conversation/{conv['id']}",headers=headers,params={'limit':50,'before_id':latest[0]['id']}).json()
    assert len(latest) == 50 and len(earlier) == 5
    assert not set(m['id'] for m in latest) & set(m['id'] for m in earlier)
    results = client.get('/api/search/messages',headers=headers,params={'q':'History item 0'}).json()
    assert results[0]['message_id'] == earlier[0]['id']
    for name,content,mime in [('brief.txt',b'Acceptance review','text/plain'),('pixel.png',base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFZkAAAAASUVORK5CYII='),'image/png')]:
        uploaded = client.post('/api/uploads',headers=headers,files={'file':(name,content,mime)})
        assert uploaded.status_code == 200
        upload = uploaded.json()
        assert Path(tmp_path,upload['public_id']).read_bytes() == content
        sent = client.post('/api/messages',headers=headers,json={'conversation_id':conv['id'],'content':'','message_type':'IMAGE' if mime.startswith('image/') else 'FILE','attachments':[upload]})
        assert sent.status_code == 201
        assert sent.json()['attachments'][0]['file_name'] == name


def test_group_admin_profile_privacy_and_session_contracts():
    client = TestClient(app)
    admin, headers = account(client,'group_owner')
    member, member_headers = account(client,'group_member')
    other, _ = account(client,'group_joiner')
    group = client.post('/api/groups',headers=headers,json={'name':'Design review','description':'Review space','member_ids':[member['user']['id']]}).json()
    assert client.put(f"/api/groups/{group['id']}",headers=member_headers,json={'name':'Unauthorized'}).status_code == 403
    assert client.post(f"/api/groups/{group['id']}/members",headers=headers,json={'user_id':other['user']['id']}).status_code == 201
    updated = client.put(f"/api/groups/{group['id']}",headers=headers,json={'name':'Product review','description':'Updated'}).json()
    assert len(updated['members']) == 3
    assert client.delete(f"/api/groups/{group['id']}/members/{other['user']['id']}",headers=headers).status_code == 200
    profile = client.put('/api/users/profile',headers=headers,json={'display_name':'Owner','bio':'Designing better conversations.'})
    assert profile.status_code == 200 and profile.json()['display_name'] == 'Owner'
    privacy = client.put('/api/users/privacy',headers=headers,json={'show_online':False,'show_last_seen':False,'show_read_receipts':False})
    assert privacy.status_code == 200 and not privacy.json()['show_read_receipts']
    refreshed = client.post('/api/auth/refresh',json={'refresh_token':admin['refresh_token']})
    assert refreshed.status_code == 200 and refreshed.json()['access_token']
    fresh_headers = {'Authorization':f"Bearer {refreshed.json()['access_token']}"}
    sessions = client.get('/api/auth/sessions',headers=fresh_headers)
    assert sessions.status_code == 200 and any(s['is_current'] for s in sessions.json())
    assert client.post('/api/auth/logout',headers=fresh_headers).status_code == 200
    assert client.get('/api/auth/me',headers=fresh_headers).status_code == 401


def test_phone_only_profile_and_privacy_responses():
    client = TestClient(app)
    phone = '+14155552679'
    registered = client.post('/api/auth/register',json={'username':'profile_phone','phone_number':phone})
    assert registered.status_code == 201
    verified = client.post('/api/auth/otp/verify',json={'identifier':phone,'otp_code':registered.json()['demo_otp'],'purpose':'REGISTER'})
    headers = {'Authorization':f"Bearer {verified.json()['access_token']}"}
    for endpoint in ['/api/auth/me','/api/users/me']:
        response = client.get(endpoint,headers=headers)
        assert response.status_code == 200
        assert response.json()['email'] is None and response.json()['phone_number'] == phone
        assert response.json()['totp_enabled'] is False
    response = client.put('/api/users/privacy',headers=headers,json={'show_online':False})
    assert response.status_code == 200 and response.json()['show_online'] is False


def test_profile_reports_verified_totp_state():
    import pyotp
    client = TestClient(app)
    _, headers = account(client,'totp_profile')
    assert client.get('/api/auth/me',headers=headers).json()['totp_enabled'] is False
    setup = client.post('/api/auth/2fa/totp/setup',headers=headers).json()
    assert client.post('/api/auth/2fa/totp/enable',headers=headers,json={'code':pyotp.TOTP(setup['secret']).now()}).status_code == 200
    assert client.get('/api/auth/me',headers=headers).json()['totp_enabled'] is True
    assert client.get('/api/auth/me',headers=headers).json()['has_password'] is True
