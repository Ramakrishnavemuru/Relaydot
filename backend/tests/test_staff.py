from fastapi.testclient import TestClient
import pyotp

from app.main import app
from app.models.user import User
from app.models.session import UserSession
from app.models.staff import SupportCase, CaseMessage, StaffNotification, ModeratorAuditLog
from app.security.jwt import create_access_token
from conftest import TestingSessionLocal


def register(client, username, role=None):
    result = client.post('/api/auth/register', json={
        'username': username, 'email': f'{username}@example.com',
        'password': 'strong-password-123', 'confirm_password': 'strong-password-123',
        'role': role or 'OWNER',
    })
    assert result.status_code == 201, result.text
    assert result.json()['user']['role'] == 'USER'
    return result.json()['user']['id']


def staff_login(client, username, role='MODERATOR'):
    user_id = register(client, username)
    secret = pyotp.random_base32()
    with TestingSessionLocal() as db:
        user = db.get(User, user_id)
        user.role = role
        user.totp_secret = secret
        user.totp_enabled = True
        db.commit()
    login = client.post('/api/staff/auth/login', json={'username_or_email': username, 'password': 'strong-password-123'})
    assert login.status_code == 200 and login.json()['requires_2fa']
    assert client.get('/api/staff/dashboard').status_code == 403
    ticket = login.json()['ticket']
    verified = client.post('/api/staff/auth/verify', json={'ticket': ticket, 'code': pyotp.TOTP(secret).now()})
    assert verified.status_code == 200, verified.text
    assert client.post('/api/auth/2fa/verify', json={'ticket': ticket, 'code': pyotp.TOTP(secret).now()}).status_code == 401
    return user_id, verified.json()['session_id']


def test_public_role_forgery_and_staff_denial():
    with TestClient(app) as client:
        user_id = register(client, 'ordinary_staff_test', role='OWNER')
        assert client.post('/api/staff/auth/login', json={'username_or_email': 'ordinary_staff_test', 'password': 'strong-password-123'}).status_code == 401
        assert client.get('/api/staff/dashboard').status_code == 403
        forged = create_access_token({'sub': str(user_id), 'role': 'OWNER'})
        assert client.get('/api/staff/dashboard', headers={'Authorization': f'Bearer {forged}'}).status_code == 401
        with TestingSessionLocal() as db:
            assert db.get(User, user_id).role == 'USER'


def test_staff_mfa_replay_refresh_revocation_and_owner_boundary():
    with TestClient(app) as client:
        user_id, sid = staff_login(client, 'staff_auth_test')
        assert client.get('/api/staff/dashboard').status_code == 200
        assert client.post('/api/staff/moderators/invite', json={'email': 'any@example.com'}).status_code == 403
        refresh = client.post('/api/auth/refresh', json={})
        assert refresh.status_code == 200
        assert client.get('/api/staff/dashboard').status_code == 200
        with TestingSessionLocal() as db:
            session = db.query(UserSession).filter_by(session_id=sid, user_id=user_id).one()
            session.revoked = True
            db.commit()
        assert client.get('/api/staff/dashboard').status_code == 401


def test_case_ownership_private_notes_notifications_and_audit():
    with TestClient(app) as reporter:
        first_id = register(reporter, 'case_owner_test')
        with TestClient(app) as another:
            register(another, 'case_other_test')
            with TestClient(app) as staff:
                staff_id, _ = staff_login(staff, 'case_moderator_test')
                result = reporter.post('/api/support/cases', json={
                    'kind': 'BUG', 'category': 'Messaging', 'title': 'Messages do not load',
                    'description': 'The message list stays empty after opening a conversation',
                    'steps': 'Open chats and select a conversation', 'expected': 'Messages appear',
                    'actual': 'Empty list',
                })
                assert result.status_code == 201, result.text
                case_id = result.json()['id']
                assert another.get(f'/api/support/cases/{case_id}').status_code == 404
                assert another.post(f'/api/support/cases/{case_id}/reply', json={'body': 'steal'}).status_code == 404
                assert staff.get('/api/staff/cases').json()['total'] == 1
                assert staff.get('/api/staff/notifications').json()[0]['target_id'] == case_id
                assert staff.post(f'/api/staff/cases/{case_id}/reply', json={'body': 'Internal investigation', 'internal': True}).status_code == 201
                assert staff.post(f'/api/staff/cases/{case_id}/reply', json={'body': 'Please send the app version', 'internal': False}).status_code == 201
                own = reporter.get(f'/api/support/cases/{case_id}').json()
                assert len(own['messages']) == 1
                assert own['messages'][0]['body'] == 'Please send the app version'
                assert staff.patch(f'/api/staff/cases/{case_id}', json={'status': 'RESOLVED', 'reason': 'Issue verified'}).status_code == 200
                with TestingSessionLocal() as db:
                    assert db.get(SupportCase, case_id).reporter_id == first_id
                    assert db.query(CaseMessage).filter_by(case_id=case_id, internal=True).count() == 1
                    assert db.query(StaffNotification).filter_by(recipient_id=staff_id, target_id=case_id).count() >= 1
                    assert db.query(ModeratorAuditLog).filter_by(action='CASE_UPDATED', target_id=case_id).count() == 1


def test_otp_random_attempt_cap_and_totp_demo_bypass_removed():
    with TestClient(app) as client:
        register(client, 'otp_security_test')
        first = client.post('/api/auth/otp/send', json={'identifier': 'otp_security_test@example.com', 'purpose': 'LOGIN'}).json()['demo_otp']
        second = client.post('/api/auth/otp/send', json={'identifier': 'otp_security_test@example.com', 'purpose': 'LOGIN'}).json()['demo_otp']
        assert first != second
        for _ in range(5):
            assert client.post('/api/auth/otp/verify', json={'identifier': 'otp_security_test@example.com', 'purpose': 'LOGIN', 'otp_code': '000000'}).status_code == 400
        assert client.post('/api/auth/otp/verify', json={'identifier': 'otp_security_test@example.com', 'purpose': 'LOGIN', 'otp_code': second}).status_code == 400
        setup = client.post('/api/auth/2fa/totp/setup')
        assert setup.status_code == 200
        assert client.post('/api/auth/2fa/totp/enable', json={'code': '123456'}).status_code == 400


def test_private_attachment_validation_and_owner_actions():
    with TestClient(app) as reporter:
        register(reporter, 'attach_reporter_test')
        with TestClient(app) as outsider:
            register(outsider, 'attach_outsider_test')
            with TestClient(app) as staff:
                staff_id, _ = staff_login(staff, 'attach_owner_test', role='OWNER')
                created = reporter.post('/api/support/cases', json={
                    'kind': 'SUPPORT', 'category': 'Account', 'title': 'Need account help',
                    'description': 'I cannot understand my account settings',
                })
                assert created.status_code == 201
                case_id = created.json()['id']
                route = f'/api/support/cases/{case_id}/attachments'
                assert reporter.post(route, files={'file': ('payload.svg', b'<svg>unsafe</svg>', 'image/svg+xml')}).status_code == 422
                assert reporter.post(route, files={'file': ('huge.png', b'\x89PNG\r\n\x1a\n' + b'a' * (5 * 1024 * 1024), 'image/png')}).status_code == 413
                stored = reporter.post(route, files={'file': ('capture.png', b'\x89PNG\r\n\x1a\n' + b'test', 'image/png')})
                assert stored.status_code == 201, stored.text
                url = stored.json()['url']
                assert outsider.get(url).status_code == 403
                assert reporter.get(url).status_code == 200
                assert staff.get(url).status_code == 200
                assert outsider.get('/api/staff/audit-logs').status_code == 403
                assert staff.get('/api/staff/audit-logs').status_code == 200
                assert staff.post('/api/staff/moderators/invite', json={'email': 'attach_outsider_test@example.com'}).status_code == 422
                with TestingSessionLocal() as db:
                    target = db.get(User, staff_id)
                    assert target.role == 'OWNER'


def test_banned_account_can_appeal_but_cannot_use_consumer_or_staff_apis():
    with TestClient(app) as member, TestClient(app) as owner:
        member_id = register(member, 'appeal_member_test')
        staff_login(owner, 'appeal_owner_test', role='OWNER')
        ban = owner.post(f'/api/staff/users/{member_id}/actions', json={
            'action': 'BAN', 'reason': 'Repeated abuse after prior warning',
        })
        assert ban.status_code == 201, ban.text
        assert member.get('/api/auth/me').json()['account_state'] == 'BANNED'
        assert member.get('/api/social/feed').status_code == 403
        assert member.get('/api/staff/dashboard').status_code == 403
        assert member.get('/api/support/actions').json()[0]['id'] == ban.json()['id']
        appeal = member.post('/api/support/appeals', json={
            'action_id': ban.json()['id'], 'body': 'Please review this account action and evidence.',
        })
        assert appeal.status_code == 201, appeal.text
        assert member.get('/api/support/appeals').json()[0]['id'] == appeal.json()['id']


def test_cookie_refresh_rejects_cross_site_origin():
    with TestClient(app) as client:
        register(client, 'csrf_refresh_test')
        blocked = client.post('/api/auth/refresh', json={}, headers={'Origin': 'https://attacker.example'})
        assert blocked.status_code == 403
        assert client.post('/api/auth/refresh', json={}).status_code == 200
