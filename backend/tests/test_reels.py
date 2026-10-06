"""Reel processing, privacy, engagement, and media authorization regressions."""
import asyncio
import shutil
import subprocess
from urllib.parse import urlsplit
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.models.reel import Reel
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
        data={'caption':'A small moment #blue @reel_bob','visibility':'EVERYONE'})
    assert uploaded.status_code == 201, uploaded.text
    key = uploaded.json()['public_id']
    assert uploaded.json()['status'] == 'PROCESSING'
    with TestingSessionLocal() as db:
        row = db.query(Reel).filter_by(public_id=key).first()
        asyncio.run(reel_processor.process_reel(row.id))
    page = client.get(f'/api/reels/{key}',headers=bh)
    assert page.status_code == 200, page.text
    assert page.json()['status'] == 'PUBLISHED'
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
        json={'session_id':'browser-test-1','watched_ms':3500}).json()['counted']
    assert client.post(f'/api/reels/{key}/view',headers=bh,
        json={'session_id':'browser-test-1','watched_ms':4000}).json()['counted']
    assert client.get(f'/api/reels/{key}/analytics',headers=ah).json()['views'] == 1
    assert client.get(f'/api/reels/{key}/analytics',headers=bh).status_code == 404
    direct = client.post('/api/conversations/direct',headers=ah,json={'recipient_id':bob}).json()['id']
    assert client.post(f'/api/reels/{key}/share',headers=bh,
        json={'conversation_id':direct}).status_code == 200
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
    assert result.status_code == 201
    key = result.json()['public_id']
    with TestingSessionLocal() as db:
        asyncio.run(reel_processor.process_reel(db.query(Reel).filter_by(public_id=key).one().id))
    failed = client.get(f'/api/reels/{key}',headers=ah).json()
    assert failed['status'] == 'FAILED' and failed['error']
    assert client.get(f'/api/reels/{key}',headers=bh).status_code == 404
