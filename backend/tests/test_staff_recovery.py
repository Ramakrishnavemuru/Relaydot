from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, parse_qs

import pyotp
from conftest import BrowserTestClient as TestClient

from app.config import settings
from app.main import app
from app.models.session import UserSession
from app.models.staff import ModeratorAuditLog, StaffPasswordReset
from app.models.user import User
from app.security.jwt import hash_token
from app.security.password import verify_password
from app.services import staff_recovery
from app.services.auth_service import RESET_CODES
from conftest import TestingSessionLocal

OLD = 'strong-password-123'
NEW = 'a-new-long-password-456'


def prepare_staff(client, username='recovery_owner', role='OWNER'):
    result = client.post('/api/auth/register', json={
        'username': username, 'email': f'{username}@example.com',
        'password': OLD, 'confirm_password': OLD,
    })
    assert result.status_code == 201, result.text
    user_id = result.json()['user']['id']
    secret = pyotp.random_base32()
    with TestingSessionLocal() as db:
        user = db.get(User, user_id)
        user.role = role
        user.totp_secret = secret
        user.totp_enabled = True
        db.commit()
    return user_id, secret


def enable_mail(monkeypatch):
    sent = []
    monkeypatch.setattr(settings, 'SMTP_HOST', 'smtp.test.local')
    monkeypatch.setattr(settings, 'SMTP_FROM_EMAIL', 'security@test.local')
    monkeypatch.setattr(settings, 'STAFF_RECOVERY_ORIGIN', 'http://localhost:8000')
    monkeypatch.setattr(staff_recovery, '_send_email', lambda recipient, subject, body: sent.append((recipient, subject, body)))
    return sent


def request_token(client, email, sent):
    result = client.post('/api/staff/auth/recovery/request', json={'email': email})
    assert result.status_code == 200, result.text
    assert result.json() == {'message': staff_recovery.GENERIC_RESPONSE}
    assert result.headers['cache-control'] == 'no-store'
    assert sent
    link = sent[-1][2].split('Open this link within 15 minutes: ')[1].split('\n')[0]
    assert link.startswith('http://localhost:8000/app/staff/reset-password#token=')
    return parse_qs(urlsplit(link).fragment)['token'][0]


def complete(client, token, code, password=NEW):
    return client.post('/api/staff/auth/recovery/reset', json={
        'token': token, 'totp_code': code, 'new_password': password,
        'confirm_password': password,
    })


def test_staff_recovery_preserves_account_mfa_and_revokes_sessions(monkeypatch):
    sent = enable_mail(monkeypatch)
    with TestClient(app) as client:
        user_id, secret = prepare_staff(client)
        assert client.get('/api/auth/me').status_code == 200
        token = request_token(client, 'recovery_owner@example.com', sent)
        with TestingSessionLocal() as db:
            row = db.query(StaffPasswordReset).one()
            assert row.user_id == user_id
            assert row.token_hash == hash_token(token)
            assert token != row.token_hash
            assert row.expires_at - row.created_at == timedelta(minutes=15)
        wrong = '000000' if pyotp.TOTP(secret).now() != '000000' else '999999'
        assert complete(client, token, wrong).status_code == 400
        valid = complete(client, token, pyotp.TOTP(secret).now())
        assert valid.status_code == 200, valid.text
        assert client.get('/api/auth/me').status_code == 401
        assert complete(client, token, pyotp.TOTP(secret).now()).status_code == 400
        assert any('password changed' in subject.lower() for _, subject, _ in sent)
        with TestingSessionLocal() as db:
            user = db.get(User, user_id)
            assert user.id == user_id and user.email == 'recovery_owner@example.com'
            assert user.role == 'OWNER' and user.totp_enabled and user.totp_secret == secret
            assert verify_password(NEW, user.password_hash)
            assert not verify_password(OLD, user.password_hash)
            assert db.query(UserSession).filter_by(user_id=user_id, revoked=False).count() == 0
            assert db.query(ModeratorAuditLog).filter_by(action='STAFF_PASSWORD_RECOVERY', target_id=user_id).count() == 1
        assert client.post('/api/staff/auth/login', json={'username_or_email': 'recovery_owner', 'password': OLD}).status_code == 401
        login = client.post('/api/staff/auth/login', json={'username_or_email': 'recovery_owner', 'password': NEW})
        assert login.status_code == 200 and login.json()['requires_2fa']
        verified = client.post('/api/staff/auth/verify', json={'ticket': login.json()['ticket'], 'code': pyotp.TOTP(secret).at((int(datetime.now(timezone.utc).timestamp()) // 30 + 1) * 30)})
        assert verified.status_code == 200, verified.text
        assert client.get('/api/staff/dashboard').status_code == 200


def test_unknown_and_ordinary_accounts_get_same_response(monkeypatch):
    sent = enable_mail(monkeypatch)
    with TestClient(app) as client:
        result = client.post('/api/auth/register', json={
            'username': 'ordinary_recovery', 'email': 'ordinary_recovery@example.com',
            'password': OLD, 'confirm_password': OLD,
        })
        assert result.status_code == 201
        replies = [client.post('/api/staff/auth/recovery/request', json={'email': email}) for email in
                   ('nobody@example.com', 'ordinary_recovery@example.com')]
        assert all(reply.status_code == 200 for reply in replies)
        assert replies[0].json() == replies[1].json() == {'message': staff_recovery.GENERIC_RESPONSE}
        assert sent == []
        assert client.post('/api/staff/auth/recovery/request', json={'email': 'nobody@example.com'},
                           headers={'Origin': 'https://evil.example'}).status_code == 403


def test_expired_token_and_replayed_totp_rejected(monkeypatch):
    sent = enable_mail(monkeypatch)
    with TestClient(app) as client:
        user_id, secret = prepare_staff(client, 'recovery_expired')
        token = request_token(client, 'recovery_expired@example.com', sent)
        with TestingSessionLocal() as db:
            db.query(StaffPasswordReset).filter_by(user_id=user_id).update({'expires_at': datetime.now(timezone.utc) - timedelta(seconds=1)})
            db.commit()
        assert complete(client, token, pyotp.TOTP(secret).now()).status_code == 400
        fresh = request_token(client, 'recovery_expired@example.com', sent)
        assert complete(client, fresh, pyotp.TOTP(secret).now()).status_code == 200
        again = request_token(client, 'recovery_expired@example.com', sent)
        assert complete(client, again, pyotp.TOTP(secret).now(), 'another-long-password-789').status_code == 400


def test_new_request_invalidates_older_link_and_bad_codes_lock_link(monkeypatch):
    sent = enable_mail(monkeypatch)
    with TestClient(app) as client:
        user_id, secret = prepare_staff(client, 'recovery_invalidated')
        old = request_token(client, 'recovery_invalidated@example.com', sent)
        current = request_token(client, 'recovery_invalidated@example.com', sent)
        assert complete(client, old, pyotp.TOTP(secret).now()).status_code == 400
        wrong = '000000' if pyotp.TOTP(secret).now() != '000000' else '999999'
        for _ in range(5):
            assert complete(client, current, wrong).status_code == 400
        assert complete(client, current, pyotp.TOTP(secret).now()).status_code == 400
        with TestingSessionLocal() as db:
            rows = db.query(StaffPasswordReset).filter_by(user_id=user_id).all()
            assert len(rows) == 2 and all(row.consumed_at for row in rows)


def test_general_password_reset_cannot_bypass_staff_mfa(monkeypatch):
    enable_mail(monkeypatch)
    with TestClient(app) as client:
        user_id, _ = prepare_staff(client, 'recovery_bypass')
        result = client.post('/api/auth/forgot-password', json={'email': 'recovery_bypass@example.com'})
        assert result.status_code == 200
        assert not result.json().get('demo_code')
        from datetime import datetime, timezone
        RESET_CODES['recovery_bypass@example.com'] = {
            'code_hash': hash_token('123456'), 'timestamp': datetime.now(timezone.utc), 'attempts': 0,
        }
        bypass = client.post('/api/auth/reset-password', json={
            'email': 'recovery_bypass@example.com', 'reset_code': '123456',
            'new_password': NEW, 'confirm_new_password': NEW,
        })
        assert bypass.status_code == 400
        RESET_CODES.pop('recovery_bypass@example.com', None)
        with TestingSessionLocal() as db:
            assert db.get(User, user_id).role == 'OWNER'
        assert client.post('/api/staff/auth/recovery/reset', json={
            'token': 'A' * 64, 'totp_code': '123456', 'new_password': NEW,
            'confirm_password': NEW,
        }).status_code == 400


def test_recovery_requires_configured_mail_for_every_email(monkeypatch):
    monkeypatch.setattr(settings, 'SMTP_HOST', '')
    monkeypatch.setattr(settings, 'SMTP_FROM_EMAIL', '')
    with TestClient(app) as client:
        prepare_staff(client, 'recovery_no_mail')
        known = client.post('/api/staff/auth/recovery/request', json={'email': 'recovery_no_mail@example.com'})
        unknown = client.post('/api/staff/auth/recovery/request', json={'email': 'unknown@example.com'})
        assert known.status_code == unknown.status_code == 503
        assert known.json() == unknown.json()


def test_delivery_uses_smtp_tls_without_logging_token(monkeypatch):
    events = []
    class SMTP:
        def __init__(self, host, port, timeout): events.append(('connect', host, port, timeout))
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def starttls(self, context): events.append(('tls', bool(context)))
        def login(self, username, password): events.append(('login', username, password))
        def send_message(self, message): events.append(('send', message['To'], message['Subject']))
    monkeypatch.setattr(settings, 'SMTP_HOST', 'smtp.test.local')
    monkeypatch.setattr(settings, 'SMTP_PORT', 587)
    monkeypatch.setattr(settings, 'SMTP_FROM_EMAIL', 'security@test.local')
    monkeypatch.setattr(settings, 'SMTP_USERNAME', 'account')
    monkeypatch.setattr(settings, 'SMTP_PASSWORD', 'test-secret')
    monkeypatch.setattr(settings, 'SMTP_USE_SSL', False)
    monkeypatch.setattr(staff_recovery.smtplib, 'SMTP', SMTP)
    staff_recovery._send_email('staff@example.com', 'Recovery', 'link')
    assert events[0][:3] == ('connect', 'smtp.test.local', 587)
    assert events[1][0] == 'tls'
    assert events[2][:2] == ('login', 'account')
    assert events[3] == ('send', 'staff@example.com', 'Recovery')
