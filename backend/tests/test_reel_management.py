from datetime import datetime, timezone
from pathlib import Path

from conftest import BrowserTestClient as TestClient

from app.main import app
from app.models.reel import Reel, ReelLike, ReelShare
from app.routes import reels as reel_routes
from conftest import TestingSessionLocal
from test_creator import creator, register


def make_reel(db, owner_id: int, key: str, folder: Path) -> Reel:
    folder.mkdir(parents=True, exist_ok=True)
    video = folder / 'video.mp4'
    cover = folder / 'cover.jpg'
    video.write_bytes(b'video for signed download test')
    cover.write_bytes(b'cover')
    now = datetime.now(timezone.utc)
    reel = Reel(public_id=key, creator_id=owner_id, caption=key, source_path=str(video),
                video_path=str(video), thumbnail_path=str(cover), duration=6,
                status='PUBLISHED', visibility='EVERYONE', created_at=now, published_at=now)
    db.add(reel); db.commit(); db.refresh(reel)
    return reel


def test_creator_reel_management_is_per_item_and_authorized(tmp_path, monkeypatch):
    monkeypatch.setattr(reel_routes, 'MEDIA_ROOT', tmp_path)
    with TestClient(app) as owner, TestClient(app) as visitor, TestClient(app) as personal:
        owner_id = creator(owner, 'manage_creator')
        visitor_id = register(visitor, 'manage_visitor')
        personal_id = register(personal, 'manage_personal')
        keys = ['manage_reel_one', 'manage_reel_two', 'manage_reel_three', 'manage_reel_four']
        with TestingSessionLocal() as db:
            rows = [make_reel(db, owner_id, key, tmp_path / key) for key in keys]
            ids = [row.id for row in rows]
            db.add(ReelLike(reel_id=ids[0], user_id=visitor_id))
            db.add(ReelShare(reel_id=ids[0], user_id=visitor_id))
            make_reel(db, personal_id, 'personal_manage_reel', tmp_path / 'personal_manage_reel')
            db.commit()
        key = keys[0]
        assert visitor.patch(f'/api/reels/{key}', json={'pinned': True}).status_code == 404
        assert personal.patch('/api/reels/personal_manage_reel', json={'pinned': True}).status_code == 403
        initial = visitor.get(f'/api/reels/{key}').json()
        old_download = initial['video_url'].replace('/media/video?', '/media/download?')
        assert visitor.get(old_download).status_code == 403
        changed = owner.patch(f'/api/reels/{key}', json={
            'hide_like_count': True, 'hide_share_count': True, 'allow_comments': False,
            'allow_download': True, 'partnership_label': True, 'partnership_partner': 'Sample Brand',
            'cover_crop_x': 25, 'cover_crop_y': 70, 'cover_zoom': 1.4,
        })
        assert changed.status_code == 200, changed.text
        public = visitor.get(f'/api/reels/{key}').json()
        assert public['likes_count'] is None and public['shares_count'] is None
        assert public['partnership_label'] and public['partnership_partner'] == 'Sample Brand'
        assert public['cover_crop_x'] == 25 and public['cover_crop_y'] == 70 and public['cover_zoom'] == 1.4
        assert public['download_url']
        assert visitor.get(public['download_url']).status_code == 200
        assert visitor.post(f'/api/reels/{key}/comments', json={'content': 'Blocked'}).status_code == 403
        assert owner.get(f'/api/reels/{key}').json()['likes_count'] == 1
        assert owner.patch(f'/api/reels/{key}', json={
            'hide_like_count': False, 'hide_share_count': False, 'allow_comments': True,
            'allow_download': False, 'partnership_label': False,
        }).status_code == 200
        restored = visitor.get(f'/api/reels/{key}').json()
        assert restored['likes_count'] == restored['shares_count'] == 1
        assert not restored['partnership_label'] and not restored['download_url']
        assert visitor.get(public['download_url']).status_code == 403
        assert visitor.post(f'/api/reels/{key}/comments', json={'content': 'Allowed'}).status_code == 201
        assert visitor.get(f'/api/reels/{keys[1]}').json()['allow_comments']

        assert owner.patch(f'/api/reels/{key}', json={'show_on_main_grid': False}).json()['show_on_main_grid'] is False
        assert not any(row['public_id'] == key for row in visitor.get(
            f'/api/reels?creator_id={owner_id}&placement=main').json()['items'])
        assert any(row['public_id'] == key for row in visitor.get(
            f'/api/reels?creator_id={owner_id}').json()['items'])
        assert owner.patch(f'/api/reels/{key}', json={'pinned': True}).json()['show_on_main_grid'] is True
        for second in keys[1:3]:
            assert owner.patch(f'/api/reels/{second}', json={'pinned': True}).status_code == 200
        assert owner.patch(f'/api/reels/{keys[3]}', json={'pinned': True}).status_code == 409
        assert owner.patch(f'/api/reels/{key}', json={'pinned': False}).json()['pinned'] is False
        assert owner.patch(f'/api/reels/{keys[3]}', json={'pinned': True}).status_code == 200

        old_video = public['video_url']
        assert owner.patch(f'/api/reels/{key}', json={'archive': True}).json()['status'] == 'ARCHIVED'
        assert visitor.get(f'/api/reels/{key}').status_code == 404
        assert visitor.get(old_video).status_code == 404
        assert all(row['public_id'] != key for row in visitor.get('/api/reels').json()['items'])
        assert any(row['public_id'] == key for row in owner.get('/api/reels?mode=archive').json()['items'])
        archived_owner = owner.get(f'/api/reels/{key}')
        assert archived_owner.status_code == 200
        assert visitor.get(archived_owner.json()['video_url']).status_code == 403
        assert owner.get(f'/api/creator/insights/REEL/{ids[0]}/detail').status_code == 200
        assert owner.patch(f'/api/reels/{key}', json={'archive': False}).json()['status'] == 'PUBLISHED'
        assert visitor.get(f'/api/reels/{key}').json()['likes_count'] == 1
        assert owner.delete(f'/api/reels/{key}').json()['deleted']
        assert visitor.get(f'/api/reels/{key}').status_code == 404
        assert not (tmp_path / key / 'video.mp4').exists()
        assert visitor.get(f'/api/reels/{keys[1]}').status_code == 200


def test_profile_posts_and_reels_share_pin_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(reel_routes, 'MEDIA_ROOT', tmp_path)
    with TestClient(app) as owner, TestClient(app) as visitor:
        owner_id = creator(owner, 'profile_pin_creator')
        register(visitor, 'profile_pin_visitor')
        post = owner.post('/api/social/posts', json={'content': 'Profile item'})
        assert post.status_code == 201, post.text
        post_id = post.json()['id']
        assert visitor.post(f'/api/social/posts/{post_id}/profile-pin').status_code == 403
        assert owner.post(f'/api/social/posts/{post_id}/profile-pin').json()['profile_pinned_at']
        with TestingSessionLocal() as db:
            for index in range(3):
                make_reel(db, owner_id, f'profile_pin_reel_{index}', tmp_path / f'profile_pin_reel_{index}')
        for index in range(2):
            assert owner.patch(f'/api/reels/profile_pin_reel_{index}', json={'pinned': True}).status_code == 200
        assert owner.patch('/api/reels/profile_pin_reel_2', json={'pinned': True}).status_code == 409
        assert owner.delete(f'/api/social/posts/{post_id}/profile-pin').json()['profile_pinned_at'] is None
        assert owner.patch('/api/reels/profile_pin_reel_2', json={'pinned': True}).status_code == 200
