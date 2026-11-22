"""Reel processing, privacy, engagement, and media authorization regressions."""
import asyncio
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
import pytest
from conftest import BrowserTestClient as TestClient
from app.main import app
from app.models.reel import Reel, ReelPlayback
from app.routes import reels as reel_routes
from app.services import reel_processor
from conftest import TestingSessionLocal


def account(client, name):
    result = client.post('/api/auth/register', json={'username':name,
        'email':f'{name}@example.com','password':'password123','confirm_password':'password123'})
    assert result.status_code == 201, result.text
    body = result.json()
    return body['user']['id'], {'Authorization':f"Bearer {body['access_token']}"}


@pytest.fixture
def video(tmp_path):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        pytest.skip('ffmpeg and ffprobe are required for Reel processing')
    path = tmp_path / 'sample.mp4'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi',
        '-i','color=c=blue:s=180x320:r=12:d=2','-c:v','libx264','-pix_fmt','yuv420p',
        str(path)],check=True,timeout=20)
    return path.read_bytes()


def test_upload_processing_privacy_and_engagement(tmp_path, monkeypatch, video):
    monkeypatch.setattr(reel_processor,'MEDIA_ROOT',tmp_path)
    monkeypatch.setattr(reel_routes,'MEDIA_ROOT',tmp_path)
    monkeypatch.setattr(reel_processor,'SessionLocal',TestingSessionLocal)
    client = TestClient(app)
    alice, ah = account(client,'reel_alice')
    bob, bh = account(client,'reel_bob')
    bad = client.post('/api/reels',headers=ah,files={'video':('bad.mp4',b'not a video','video/mp4')})
    assert bad.status_code == 400
    uploaded = client.post('/api/reels',headers=ah,files={'video':('short.mp4',video,'video/mp4')},
        data={'caption':"Mitc'HELL' <script>alert(1)</script> #blue @reel_bob",'visibility':'EVERYONE'})
    assert uploaded.status_code == 201, uploaded.text
    key = uploaded.json()['public_id']
    assert uploaded.json()['status'] == 'PROCESSING'
    with TestingSessionLocal() as db:
        row = db.query(Reel).filter_by(public_id=key).first()
        asyncio.run(reel_processor.process_reel(row.id))
    page = client.get(f'/api/reels/{key}',headers=bh)
    assert page.status_code == 200, page.text
    assert page.json()['status'] == 'PUBLISHED'
    assert page.json()['caption'] == "Mitc'HELL' <script>alert(1)</script> #blue @reel_bob"
    with TestingSessionLocal() as db:
        assert '&lt;script&gt;' in db.query(Reel).filter_by(public_id=key).first().caption
    assert page.json()['hashtags'] == ['blue']
    assert client.get(page.json()['video_url']).status_code == 200
    assert client.get(page.json()['video_url'], headers={'Range':'bytes=0-99'}).status_code == 206
    assert client.get(page.json()['thumbnail_url']).status_code == 200
    assert client.post(f'/api/reels/{key}/cover',headers=bh,
        data={'time_seconds':'1'}).status_code == 404
    assert client.post(f'/api/reels/{key}/cover',headers=ah,
        data={'time_seconds':'1'}).status_code == 200
    assert client.post(f'/api/reels/{key}/cover-upload',headers=ah,
        files={'image':('bad.png',b'not an image','image/png')}).status_code == 400
    cover_path = tmp_path / 'chosen.png'
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi',
        '-i','color=c=red:s=180x320:d=1','-frames:v','1',str(cover_path)],
        check=True,timeout=20)
    assert client.post(f'/api/reels/{key}/cover-upload',headers=ah,
        files={'image':('chosen.png',cover_path.read_bytes(),'image/png')}).status_code == 200
    assert client.get('/api/reels',headers=bh).json()['items'][0]['public_id'] == key
    assert client.post(f'/api/reels/{key}/like',headers=bh).json()['liked']
    assert client.post(f'/api/reels/{key}/bookmark',headers=bh).json()['bookmarked']
    comment = client.post(f'/api/reels/{key}/comments',headers=bh,json={'content':'Nice clip'})
    assert comment.status_code == 201, comment.text
    assert comment.json()['content'] == 'Nice clip'
    assert any(item['id'] == comment.json()['id'] for item in client.get(f'/api/reels/{key}/comments',headers=bh).json()['items'])
    reply = client.post(f'/api/reels/{key}/comments',headers=ah,
        json={'content':'Thanks','parent_id':comment.json()['id']})
    assert reply.status_code == 201
    pin_path = f"/api/reels/{key}/comments/{comment.json()['id']}/pin"
    assert client.post(pin_path,headers=bh).status_code == 404
    assert client.post(pin_path,headers=ah).json()['pinned']
    assert client.get(f'/api/reels/{key}/comments',headers=ah).json()['items'][0]['pinned']
    assert not client.delete(pin_path,headers=ah).json()['pinned']
    assert client.post(f"/api/reels/{key}/comments/{comment.json()['id']}/report",
        headers=ah,data={'reason':'spam','details':'Review this comment'}).json()['reported']
    assert client.post(f"/api/reels/{key}/comments/{comment.json()['id']}/report",
        headers=ah,data={'reason':'spam'}).json()['reported']
    assert client.post(f"/api/reels/{key}/comments/{reply.json()['id'] + 100}/report",
        headers=bh,data={'reason':'spam'}).status_code == 404
    assert client.post(f'/api/reels/{key}/view',headers=bh,
        json={'session_id':'browser-test-1','watched_ms':2000}).json()['counted'] is False
    assert client.post(f'/api/reels/{key}/view',headers=bh,
        json={'session_id':'browser-test-1','watched_ms':3500}).json()['counted'] is False
    session_id = 'a' * 32
    assert client.post(f'/api/reels/{key}/playback',headers=bh,json={
        'session_id':session_id,'sequence':0,'event':'START'}).status_code == 200
    with TestingSessionLocal() as db:
        playback = db.query(ReelPlayback).filter_by(session_id=session_id).one()
        playback.last_event_at = datetime.now(timezone.utc) - timedelta(seconds=4)
        db.commit()
    assert client.post(f'/api/reels/{key}/playback',headers=bh,json={
        'session_id':session_id,'sequence':1,'event':'PROGRESS',
        'delta_ms':3500,'position_ms':1500}).json()['qualified'] is True
    assert client.post(f'/api/reels/{key}/view',headers=bh,
        json={'session_id':session_id,'watched_ms':4000}).json()['counted']
    assert client.get(f'/api/reels/{key}/analytics',headers=ah).json()['views'] == 1
    assert client.get(f'/api/reels/{key}/analytics',headers=bh).status_code == 404
    direct = client.post('/api/conversations/direct',headers=ah,json={'recipient_id':bob}).json()['id']
    assert client.post(f'/api/reels/{key}/share',headers=bh,
        json={'conversation_id':direct}).status_code == 200
    shared = client.get(f'/api/messages/conversation/{direct}', headers=ah).json()
    assert shared[-1]['message_type'] == 'REEL'
    assert shared[-1]['content'] == key
    assert client.patch(f'/api/reels/{key}',headers=bh,json={'caption':'Stolen'}).status_code == 404
    assert client.patch(f'/api/reels/{key}',headers=ah,
        json={'visibility':'ONLY_ME'}).status_code == 200
    assert client.get(f'/api/reels/{key}',headers=bh).status_code == 404
    assert client.get(page.json()['video_url']).status_code == 404
    assert client.post(f'/api/reels/{key}/like',headers=bh).status_code == 404
    assert client.patch(f'/api/reels/{key}',headers=ah,
        json={'visibility':'FOLLOWERS'}).status_code == 200
    assert client.get(f'/api/reels/{key}',headers=bh).status_code == 404
    assert client.post(f'/api/social/profiles/{alice}/follow',headers=bh).status_code == 200
    assert client.get(f'/api/reels/{key}',headers=bh).status_code == 200
    assert client.patch(f'/api/reels/{key}',headers=ah,json={'archive':True}).json()['status'] == 'ARCHIVED'
    assert client.get(f'/api/reels/{key}',headers=bh).status_code == 404
    assert client.get(f'/api/reels/{key}',headers=ah).status_code == 200
    assert client.patch(f'/api/reels/{key}',headers=ah,json={'archive':False}).json()['status'] == 'PUBLISHED'


def test_published_reel_reaches_other_accounts_for_you_and_following(tmp_path, monkeypatch, video):
    monkeypatch.setattr(reel_processor, 'MEDIA_ROOT', tmp_path)
    monkeypatch.setattr(reel_routes, 'MEDIA_ROOT', tmp_path)
    monkeypatch.setattr(reel_processor, 'SessionLocal', TestingSessionLocal)
    client = TestClient(app)
    creator, creator_headers = account(client, 'feed_reel_creator')
    _, viewer_headers = account(client, 'feed_reel_viewer')
    assert client.post(f'/api/social/profiles/{creator}/follow', headers=viewer_headers).status_code == 200

    def upload(publish):
        result = client.post('/api/reels', headers=creator_headers,
            files={'video': ('clip.mp4', video, 'video/mp4')},
            data={'caption': 'A new clip', 'visibility': 'EVERYONE', 'publish': str(publish).lower()})
        assert result.status_code == 201, result.text
        with TestingSessionLocal() as db:
            reel_id = db.query(Reel.id).filter_by(public_id=result.json()['public_id']).scalar()
        asyncio.run(reel_processor.process_reel(reel_id))
        return result.json()['public_id']

    published = upload(True)
    for mode in ('for_you', 'following'):
        feed = client.get('/api/reels', headers=viewer_headers, params={'mode': mode}).json()['items']
        assert published in {item['public_id'] for item in feed}

    draft = upload(False)
    assert client.get(f'/api/reels/{draft}', headers=creator_headers).json()['status'] == 'READY'
    for mode in ('for_you', 'following'):
        feed = client.get('/api/reels', headers=viewer_headers, params={'mode': mode}).json()['items']
        assert draft not in {item['public_id'] for item in feed}
    assert client.patch(f'/api/reels/{draft}', headers=creator_headers, json={'publish': True}).json()['status'] == 'PUBLISHED'
    for mode in ('for_you', 'following'):
        feed = client.get('/api/reels', headers=viewer_headers, params={'mode': mode}).json()['items']
        assert draft in {item['public_id'] for item in feed}


def test_upload_rejects_wrong_type_and_cross_reel_reply(tmp_path, monkeypatch, video):
    monkeypatch.setattr(reel_routes,'MEDIA_ROOT',tmp_path)
    client = TestClient(app)
    _, ah = account(client,'reel_cara')
    assert client.post('/api/reels',headers=ah,
        files={'video':('short.txt',video,'text/plain')}).status_code == 400
    first = client.post('/api/reels',headers=ah,
        files={'video':('one.mp4',video,'video/mp4')}).json()
    second = client.post('/api/reels',headers=ah,
        files={'video':('two.mp4',video,'video/mp4')}).json()
    with TestingSessionLocal() as db:
        for key in (first['public_id'], second['public_id']):
            reel = db.query(Reel).filter_by(public_id=key).one()
            reel.status = 'PUBLISHED'
        db.commit()
    comment = client.post(f"/api/reels/{first['public_id']}/comments",headers=ah,
        json={'content':'First'}).json()
    assert client.post(f"/api/reels/{second['public_id']}/comments",headers=ah,
        json={'content':'Wrong reply','parent_id':comment['id']}).status_code == 400


def test_invalid_video_fails_processing_without_becoming_public(tmp_path, monkeypatch):
    monkeypatch.setattr(reel_processor,'MEDIA_ROOT',tmp_path)
    monkeypatch.setattr(reel_routes,'MEDIA_ROOT',tmp_path)
    monkeypatch.setattr(reel_processor,'SessionLocal',TestingSessionLocal)
    client = TestClient(app)
    _, ah = account(client,'reel_fail_a')
    _, bh = account(client,'reel_fail_b')
    result = client.post('/api/reels',headers=ah,
        files={'video':('bad.mp4',b'\x00\x00\x00\x14ftyp' + b'garbage'*20,'video/mp4')})
    assert result.status_code == 400
    assert client.get('/api/reels',headers=bh).json()['items'] == []


def test_reel_options_schedule_poll_and_activity(tmp_path, monkeypatch, video):
    monkeypatch.setattr(reel_processor, 'MEDIA_ROOT', tmp_path)
    monkeypatch.setattr(reel_routes, 'MEDIA_ROOT', tmp_path)
    monkeypatch.setattr(reel_processor, 'SessionLocal', TestingSessionLocal)
    client = TestClient(app)
    creator, creator_headers = account(client, 'reel_options_creator')
    _, viewer_headers = account(client, 'reel_options_viewer')
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    uploaded = client.post('/api/reels', headers=creator_headers,
        files={'video': ('clip.mp4', video, 'video/mp4')},
        data={'caption': 'A vote #sports', 'location': 'Hyderabad', 'scheduled_at': future,
              'visibility': 'EVERYONE', 'hide_like_count': 'true',
              'hide_share_count': 'true', 'allow_download': 'true',
              'poll_options': '["Blue", "Red"]'})
    assert uploaded.status_code == 201, uploaded.text
    key = uploaded.json()['public_id']
    assert uploaded.json()['location'] == 'Hyderabad'
    assert uploaded.json()['scheduled_at']
    assert len(uploaded.json()['poll']) == 2
    with TestingSessionLocal() as db:
        reel_id = db.query(Reel.id).filter_by(public_id=key).scalar()
    asyncio.run(reel_processor.process_reel(reel_id))
    assert client.get(f'/api/reels/{key}', headers=creator_headers).json()['status'] == 'READY'
    assert client.get(f'/api/reels/{key}', headers=viewer_headers).status_code == 404
    with TestingSessionLocal() as db:
        scheduled = db.query(Reel).filter_by(public_id=key).one()
        scheduled.scheduled_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()

    async def run_schedule_tick():
        worker = asyncio.create_task(reel_processor.run_reel_worker())
        await asyncio.sleep(0.15)
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass

    asyncio.run(run_schedule_tick())
    assert client.get(f'/api/reels/{key}', headers=creator_headers).json()['status'] == 'PUBLISHED'
    public = client.get(f'/api/reels/{key}', headers=viewer_headers).json()
    assert public['likes_count'] is None and public['shares_count'] is None
    assert public['allow_download'] is True
    assert 'votes' not in public['poll'][0]
    option_id = public['poll'][0]['id']
    voted = client.post(f'/api/reels/{key}/poll/vote', headers=viewer_headers,
        json={'option_id': option_id})
    assert voted.status_code == 200, voted.text
    assert voted.json()['my_poll_vote'] == option_id
    assert voted.json()['poll'][0]['votes'] == 1
    assert client.post(f'/api/reels/{key}/poll/vote', headers=viewer_headers,
        json={'option_id': option_id}).status_code == 409
    assert client.post(f'/api/reels/{key}/like', headers=viewer_headers).status_code == 200
    assert client.post(f'/api/reels/{key}/comments', headers=viewer_headers,
        json={'content': 'Nice!' }).status_code == 201
    activity = client.get('/api/social/notifications', headers=creator_headers).json()['items']
    reel_events = [item for item in activity if item['type'] in {'reel_like', 'reel_comment'}]
    assert {item['type'] for item in reel_events} == {'reel_like', 'reel_comment'}
    assert all(item['reel_public_id'] == key for item in reel_events)


def test_reel_upload_limits_are_enforced_before_creation(tmp_path, monkeypatch, video):
    monkeypatch.setattr(reel_routes, 'MEDIA_ROOT', tmp_path)
    client = TestClient(app)
    _, headers = account(client, 'reel_limits_creator')
    monkeypatch.setattr(reel_routes, 'MAX_BYTES', len(video))
    too_large = client.post('/api/reels', headers=headers,
        files={'video': ('clip.mp4', video, 'video/mp4')})
    assert too_large.status_code == 413
    monkeypatch.setattr(reel_routes, 'MAX_BYTES', 50 * 1024 * 1024)
    long_clip = tmp_path / 'long.mp4'
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
        '-i', 'color=c=blue:s=32x32:r=1:d=61', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        str(long_clip)], check=True, timeout=20)
    too_long = client.post('/api/reels', headers=headers,
        files={'video': ('long.mp4', long_clip.read_bytes(), 'video/mp4')})
    assert too_long.status_code == 400
    assert client.get('/api/reels', headers=headers, params={'mode': 'mine'}).json()['items'] == []
