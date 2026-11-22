"""Call signaling is scoped to two authenticated participants and one call ID."""
from uuid import uuid4

from conftest import BrowserTestClient as TestClient

from app.main import app


def account(client, name):
    response = client.post('/api/auth/register', json={
        'username': name, 'email': f'{name}@example.com',
        'password': 'password123', 'confirm_password': 'password123',
    })
    assert response.status_code == 201
    return response.json()


def receive(socket, event):
    for _ in range(8):
        message = socket.receive_json()
        if message['event'] == event:
            return message['data']
    raise AssertionError(f'Missing {event}')


def send(socket, event, call_id, target_id, **data):
    socket.send_json({'event': event, 'data': {
        'call_id': call_id, 'target_user_id': target_id, **data,
    }})


def test_call_signaling_roles_state_and_forgery():
    with TestClient(app) as client:
        alice = account(client, 'call_alice')
        bob = account(client, 'call_bob')
        eve = account(client, 'call_eve')
        aid, bid, eid = (item['user']['id'] for item in (alice, bob, eve))
        with client.websocket_connect(f"/ws?token={alice['access_token']}") as a, \
                client.websocket_connect(f"/ws?token={bob['access_token']}") as b, \
                client.websocket_connect(f"/ws?token={eve['access_token']}") as e:
            call_id = str(uuid4())
            send(a, 'call_invite', call_id, bid, call_type='audio')
            assert receive(b, 'call_invite')['caller_id'] == aid
            send(e, 'call_invite', str(uuid4()), bid, call_type='audio')
            assert 'busy' in receive(e, 'call_error')['message'].lower()
            send(e, 'call_accept', call_id, aid)
            assert receive(e, 'call_error')['call_id'] == call_id
            send(a, 'webrtc_offer', call_id, bid, offer={'type': 'offer', 'sdp': 'test'})
            assert receive(a, 'call_error')['call_id'] == call_id
            send(b, 'call_accept', call_id, aid)
            assert receive(a, 'call_accept')['sender_id'] == bid
            assert receive(b, 'call_accept')['accepted_elsewhere'] is True
            send(e, 'ice_candidate', call_id, bid, candidate={'candidate': 'attacker'})
            assert receive(e, 'call_error')['call_id'] == call_id
            send(a, 'webrtc_offer', call_id, bid, offer={'type': 'offer', 'sdp': 'v=0'})
            assert receive(b, 'webrtc_offer')['sender_id'] == aid
            send(b, 'webrtc_answer', call_id, aid, answer={'type': 'answer', 'sdp': 'v=0'})
            assert receive(a, 'webrtc_answer')['sender_id'] == bid
            send(a, 'ice_candidate', call_id, bid, candidate={'candidate': 'candidate:1'})
            assert receive(b, 'ice_candidate')['candidate']['candidate'] == 'candidate:1'
            send(a, 'call_end', call_id, bid)
            assert receive(b, 'call_end')['call_id'] == call_id
            send(b, 'ice_candidate', call_id, aid, candidate={'candidate': 'candidate:2'})
            assert receive(b, 'call_error')['call_id'] == call_id
            assert eid not in (aid, bid)


def test_offline_and_blocked_invitations():
    with TestClient(app) as client:
        alice = account(client, 'call_block_alice')
        bob = account(client, 'call_block_bob')
        aid, bid = alice['user']['id'], bob['user']['id']
        with client.websocket_connect(f"/ws?token={alice['access_token']}") as a:
            send(a, 'call_invite', str(uuid4()), bid, call_type='video')
            assert 'offline' in receive(a, 'call_error')['message'].lower()
            with client.websocket_connect(f"/ws?token={bob['access_token']}") as b:
                headers = {'Authorization': f"Bearer {bob['access_token']}"}
                assert client.patch('/api/settings', headers=headers, json={'dm_policy': 'NOBODY'}).status_code == 200
                send(a, 'call_invite', str(uuid4()), bid, call_type='audio')
                assert 'allow' in receive(a, 'call_error')['message'].lower()
                assert aid != bid and b is not None
