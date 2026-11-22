from datetime import datetime, timedelta, timezone

from conftest import BrowserTestClient as TestClient

from app.main import app
from app.models.reel import Reel, ReelPlayback, ReelView
from app.models.social import PostCollaborator
from conftest import TestingSessionLocal
from test_creator import register


def _event(client, key, session, sequence, event, delta=0, position=0):
    return client.post(f'/api/reels/{key}/playback', json={
        'session_id': session, 'sequence': sequence, 'event': event,
        'delta_ms': delta, 'position_ms': position,
    })


def _elapse(reel_id, session):
    with TestingSessionLocal() as db:
        row = db.query(ReelPlayback).filter_by(reel_id=reel_id, session_id=session).one()
        row.last_event_at = datetime.now(timezone.utc) - timedelta(seconds=4)
        db.commit()


def test_reel_playback_and_private_insight_authorization():
    with TestClient(app) as owner, TestClient(app) as viewer, TestClient(app) as outsider:
        owner_id = register(owner, 'insight_reel_owner')
        viewer_id = register(viewer, 'insight_reel_viewer')
        register(outsider, 'insight_reel_outsider')
        now = datetime.now(timezone.utc)
        key = 'insight_reel_qualified'
        with TestingSessionLocal() as db:
            reel = Reel(public_id=key, creator_id=owner_id, caption='Measured Reel',
                        source_path='test.mp4', status='PUBLISHED', visibility='EVERYONE',
                        duration=6, created_at=now, published_at=now)
            db.add(reel); db.commit(); reel_id = reel.id
        first, second = 'a' * 32, 'b' * 32
        assert _event(viewer, key, first, 0, 'START').status_code == 200
        assert _event(viewer, key, first, 0, 'START').json()['counted'] is False
        assert _event(viewer, key, first, 1, 'PROGRESS', 3000, 3000).status_code == 400
        _elapse(reel_id, first)
        assert _event(viewer, key, first, 1, 'PROGRESS', 3000, 3000).json()['qualified'] is True
        assert _event(viewer, key, first, 1, 'PROGRESS', 3000, 3000).json()['counted'] is False
        assert _event(viewer, key, first, 2, 'PAUSE', 0, 3000).status_code == 200
        assert _event(viewer, key, first, 3, 'PROGRESS', 1000, 4000).status_code == 409
        assert _event(viewer, key, first, 3, 'RESUME', 0, 3000).status_code == 200
        _elapse(reel_id, first)
        assert _event(viewer, key, first, 4, 'COMPLETE', 2000, 5700).status_code == 200
        assert _event(viewer, key, first, 5, 'REPLAY', 0, 0).status_code == 200
        assert _event(viewer, key, first, 6, 'SKIP', 0, 0).status_code == 200
        assert _event(viewer, key, second, 0, 'START').status_code == 200
        _elapse(reel_id, second)
        assert _event(viewer, key, second, 1, 'SKIP', 1000, 1000).status_code == 200
        with TestingSessionLocal() as db:
            assert db.query(ReelView).filter_by(reel_id=reel_id, user_id=viewer_id).count() == 1
        assert outsider.get(f'/api/creator/insights/REEL/{reel_id}/detail').status_code == 404
        report = owner.get(f'/api/creator/insights/REEL/{reel_id}/detail?window=LIFETIME')
        assert report.status_code == 200, report.text
        data = report.json()
        assert data['metrics']['views'] == data['metrics']['reach'] == 1
        assert data['watch']['starts'] == 2 and data['watch']['average_watch_ms'] == 3000
        assert data['watch']['completed'] == data['watch']['skips'] == data['watch']['replays'] == 1
        assert data['rates']['skip']['value'] == data['rates']['completion']['value'] == 50
        assert data['audience'] is None and data['metrics']['reposts'] is None
        assert data['metrics']['profile_visits'] is None


def test_post_insight_owner_collaborator_and_attributed_follow():
    with TestClient(app) as owner, TestClient(app) as viewer, TestClient(app) as collaborator:
        owner_id = register(owner, 'insight_post_owner')
        register(viewer, 'insight_post_viewer')
        collab_id = register(collaborator, 'insight_post_collab')
        created = owner.post('/api/social/posts', json={'content': 'First content', 'collaborator_ids': [collab_id]})
        assert created.status_code == 201, created.text
        post_id = created.json()['id']
        assert owner.post('/api/social/posts', json={'content': 'Second content'}).status_code == 201
        assert viewer.post(f'/api/creator/posts/{post_id}/view').json()['counted'] is True
        assert viewer.post(f'/api/creator/posts/{post_id}/view').json()['counted'] is False
        assert viewer.post(f'/api/social/profiles/{owner_id}/follow?source_kind=POST&source_id={post_id}').status_code == 200
        assert collaborator.get(f'/api/creator/insights/POST/{post_id}/detail').status_code == 404
        assert collaborator.post(f'/api/social/posts/{post_id}/collaborators/respond?accept=true').status_code == 200
        assert collaborator.get(f'/api/creator/insights/POST/{post_id}/detail').status_code == 200
        detail = owner.get(f'/api/creator/insights/POST/{post_id}/detail?window=LIFETIME')
        assert detail.status_code == 200, detail.text
        data = detail.json()
        assert data['metrics']['views'] == data['metrics']['reach'] == data['metrics']['follows'] == 1
        assert data['watch'] is None and data['rates'].get('skip') is None
        assert viewer.get(f'/api/creator/insights/POST/{post_id}/detail').status_code == 404
        assert owner.get(f'/api/creator/insights/POST/{post_id+1}/detail').json()['metrics']['views'] == 0
        with TestingSessionLocal() as db:
            row = db.query(PostCollaborator).filter_by(post_id=post_id, user_id=collab_id).one()
            row.status = 'REVOKED'; db.commit()
        assert collaborator.get(f'/api/creator/insights/POST/{post_id}/detail').status_code == 404
