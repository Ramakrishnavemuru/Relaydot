import asyncio
from datetime import datetime, timedelta, timezone

from conftest import BrowserTestClient as TestClient

from app.main import app
from app.models.creator import CreatorEvent, ScheduledPost
from app.models.reel import Reel, ReelView
from app.models.social import Post, PostCollaborator
from app.models.story import Story
from app.models.user import User
from app.services import creator_scheduler
from app.services.story_service import StoryService
from conftest import TestingSessionLocal


def register(client, username):
    result = client.post('/api/auth/register', json={
        'username': username, 'email': f'{username}@example.com',
        'password': 'strong-password-123', 'confirm_password': 'strong-password-123',
    })
    assert result.status_code == 201, result.text
    return result.json()['user']['id']


def creator(client, username):
    user_id = register(client, username)
    result = client.post('/api/creator/account', json={
        'account_type': 'CREATOR', 'category': 'Digital Creator',
    })
    assert result.status_code == 200, result.text
    return user_id


def test_share_post_to_chat_and_delete_owner_post():
    with TestClient(app) as owner, TestClient(app) as recipient:
        owner_id = creator(owner, 'creator_post_share_owner')
        recipient_id = register(recipient, 'creator_post_share_recipient')
        created = owner.post('/api/social/posts', json={'content': 'A post to share'})
        assert created.status_code == 201, created.text
        post_id = created.json()['id']
        conversation = owner.post('/api/conversations/direct', json={'recipient_id': recipient_id})
        assert conversation.status_code == 201, conversation.text
        conversation_id = conversation.json()['id']
        shared = owner.post(f'/api/social/posts/{post_id}/share-to-chat', json={'conversation_id': conversation_id})
        assert shared.status_code == 200, shared.text
        messages = recipient.get(f'/api/messages/conversation/{conversation_id}')
        assert messages.status_code == 200 and any(
            f"/app/posts/{created.json()['public_id']}" in row['content'] for row in messages.json())
        shares = owner.get('/api/creator/performance?days=7&metric=shares')
        assert shares.status_code == 200 and shares.json()['value'] == 1
        assert recipient.delete(f'/api/social/posts/{post_id}').status_code in (403, 404)
        assert owner.delete(f'/api/social/posts/{post_id}').json()['deleted'] is True
        assert owner.get(f'/api/social/posts/{post_id}').status_code == 404
        with TestingSessionLocal() as db:
            assert db.get(User, owner_id).account_type == 'CREATOR'


def test_account_switch_privacy_profile_and_owner_only_dashboard():
    with TestClient(app) as owner, TestClient(app) as outsider:
        uid = register(owner, 'creator_switch')
        register(outsider, 'creator_outsider')
        assert owner.get('/api/creator/summary').status_code == 403
        assert outsider.get('/api/creator/summary').status_code == 403
        assert owner.put('/api/users/privacy', json={'is_private': True}).status_code == 200
        pending = owner.post('/api/creator/account', json={'account_type': 'CREATOR', 'category': 'Artist'})
        assert pending.status_code == 409
        assert owner.get('/api/auth/me').json()['is_private'] is True
        changed = owner.post('/api/creator/account', json={
            'account_type': 'CREATOR', 'category': 'Artist', 'confirm_public': True,
        })
        assert changed.status_code == 200 and changed.json()['is_private'] is False
        assert owner.put('/api/users/privacy', json={'is_private': True}).status_code == 400
        assert outsider.get(f'/api/social/profiles/{uid}').json()['creator_category'] == 'Artist'
        assert outsider.get('/api/creator/summary').status_code == 403
        assert owner.get('/api/creator/summary').status_code == 200
        assert owner.patch('/api/creator/profile', json={'contact_enabled': True}).status_code == 200
        assert outsider.get(f'/api/social/profiles/{uid}').json()['contact_email'] == 'creator_switch@example.com'
        assert owner.post('/api/creator/account', json={'account_type': 'PERSONAL', 'private_when_personal': True}).status_code == 200
        with TestingSessionLocal() as db:
            user = db.get(User, uid)
            assert user.account_type == 'PERSONAL' and user.is_private and user.email == 'creator_switch@example.com'
        assert owner.get('/api/creator/summary').status_code == 403
        assert outsider.get(f'/api/social/profiles/{uid}').json()['contact_email'] is None


def test_real_events_metrics_content_and_collaboration():
    with TestClient(app) as owner, TestClient(app) as visitor, TestClient(app) as collaborator:
        uid = creator(owner, 'creator_metrics')
        viewer_id = register(visitor, 'creator_viewer')
        collab_id = creator(collaborator, 'creator_collab')
        post = owner.post('/api/social/posts', json={'content': 'Real insight #test', 'collaborator_ids': [collab_id]})
        assert post.status_code == 201, post.text
        post_id = post.json()['id']
        assert visitor.post(f'/api/creator/posts/{post_id}/view').json()['counted'] is True
        assert visitor.post(f'/api/creator/posts/{post_id}/view').json()['counted'] is False
        assert visitor.post(f'/api/creator/profiles/{uid}/visit').json()['counted'] is True
        assert visitor.post(f'/api/creator/profiles/{uid}/visit').json()['counted'] is False
        assert visitor.post(f'/api/social/profiles/{uid}/follow').status_code == 200
        assert visitor.post(f'/api/social/posts/{post_id}/reaction', json={'emoji': '❤️'}).status_code == 200
        summary = owner.get('/api/creator/summary?days=7')
        assert summary.status_code == 200, summary.text
        metrics = summary.json()['metrics']
        assert metrics['views']['value'] == 1
        assert metrics['accounts_reached']['value'] == 1
        assert metrics['profile_visits']['value'] == 1
        assert metrics['followers']['value'] == 1
        assert metrics['net_followers']['value'] == 1
        performance = owner.get('/api/creator/performance?days=7&metric=views')
        assert performance.status_code == 200, performance.text
        assert sum(point['value'] for point in performance.json()['points']) == 1
        assert performance.json()['views_by_type']['text_posts'] == 1
        content = owner.get('/api/creator/content?kind=posts&sort=views')
        assert content.status_code == 200, content.text
        assert content.json()['items'][0]['id'] == post_id
        assert content.json()['items'][0]['likes'] == 1
        assert collaborator.get(f'/api/creator/insights/POST/{post_id}').status_code == 404
        accepted = collaborator.post(f'/api/social/posts/{post_id}/collaborators/respond?accept=true')
        assert accepted.status_code == 200, accepted.text
        shared = collaborator.get('/api/creator/content?kind=collaborative')
        assert shared.status_code == 200 and shared.json()['total'] == 1
        insight = collaborator.get(f'/api/creator/insights/POST/{post_id}')
        assert insight.status_code == 200 and insight.json()['views'] == 1
        assert visitor.get(f'/api/creator/insights/POST/{post_id}').status_code == 404
        assert visitor.delete(f'/api/social/profiles/{uid}/follow').status_code == 200
        audience = owner.get('/api/creator/audience')
        assert audience.status_code == 200 and audience.json()['gained'] == 1 and audience.json()['lost'] == 1
        assert audience.json()['demographics'] is None


def test_reel_story_views_and_unknown_audience_are_real():
    with TestClient(app) as owner, TestClient(app) as visitor:
        uid = creator(owner, 'creator_video')
        viewer_id = register(visitor, 'creator_watcher')
        now = datetime.now(timezone.utc)
        with TestingSessionLocal() as db:
            reel = Reel(public_id='creator_test_reel', creator_id=uid, caption='Video', source_path='test.mp4',
                        status='PUBLISHED', visibility='EVERYONE', published_at=now, created_at=now)
            story = Story(user_id=uid, media_url='/uploads/test.png', media_type='IMAGE',
                          expires_at=now + timedelta(hours=1), created_at=now)
            db.add_all([reel, story]); db.commit(); db.refresh(reel); db.refresh(story)
            reel_id, story_id = reel.id, story.id
            db.add(ReelView(reel_id=reel_id, user_id=viewer_id, session_id='legacy_view',
                            watched_ms=5000, audience_kind='UNKNOWN', created_at=now))
            db.commit()
            assert StoryService.record_view(db, story_id, viewer_id)
        result = owner.get('/api/creator/performance?metric=views')
        assert result.status_code == 200, result.text
        assert result.json()['value'] == 2
        assert result.json()['views_by_type']['reels'] == 1
        assert result.json()['views_by_type']['stories'] == 1
        assert result.json()['audience']['unknown'] == 1
        assert owner.get(f'/api/creator/insights/REEL/{reel_id}').json()['views'] == 1
        assert visitor.get(f'/api/creator/insights/REEL/{reel_id}').status_code == 404


def test_scheduled_post_publish_edit_cancel_and_idempotency(monkeypatch):
    monkeypatch.setattr(creator_scheduler, 'SessionLocal', TestingSessionLocal)
    with TestClient(app) as owner, TestClient(app) as visitor:
        uid = creator(owner, 'creator_schedule')
        register(visitor, 'creator_schedule_outsider')
        future = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        created = owner.post('/api/creator/scheduled-posts', json={
            'post': {'content': 'Scheduled from server'}, 'scheduled_at': future,
        })
        assert created.status_code == 201, created.text
        sid = created.json()['id']
        assert visitor.patch(f'/api/creator/scheduled-posts/{sid}', json={'post': {'content': 'stolen'}}).status_code == 403
        changed = owner.patch(f'/api/creator/scheduled-posts/{sid}', json={
            'post': {'content': 'Edited scheduled post'}, 'scheduled_at': future,
        })
        assert changed.status_code == 200
        with TestingSessionLocal() as db:
            row = db.get(ScheduledPost, sid)
            row.scheduled_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            row.next_attempt_at = row.scheduled_at
            db.commit()
        asyncio.run(creator_scheduler.process_due_posts())
        asyncio.run(creator_scheduler.process_due_posts())
        with TestingSessionLocal() as db:
            row = db.get(ScheduledPost, sid)
            assert row.status == 'PUBLISHED' and row.post_id
            assert db.query(Post).filter_by(author_id=uid, content='Edited scheduled post').count() == 1
        second = owner.post('/api/creator/scheduled-posts', json={
            'post': {'content': 'Will cancel'}, 'scheduled_at': future,
        })
        assert second.status_code == 201
        assert owner.delete(f"/api/creator/scheduled-posts/{second.json()['id']}").status_code == 200
        assert owner.get('/api/creator/scheduled-posts').json()['total'] == 2
