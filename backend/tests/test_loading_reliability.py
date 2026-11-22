"""Production SPA resources, deep links and cookie authentication hot path."""
import re
import pytest
from sqlalchemy import event
from fastapi.testclient import TestClient
from app.main import app
from conftest import test_engine


@pytest.mark.parametrize('route', [
    '', 'login', 'register', 'forgot-password', 'chats', 'profile', 'settings',
    'reels', 'explore', 'notifications', 'bookmarks', 'communities',
    'professional-dashboard', 'posts/unavailable', 'staff/login',
    'staff/forgot-password', 'staff/reset-password', 'appeal',
])
def test_spa_deep_links_have_recovery_shell_and_valid_assets(route):
    client = TestClient(app)
    response = client.get('/app/' + route)
    assert response.status_code == 200
    assert 'Content-Security-Policy' in response.headers
    assert 'startup-recovery' in response.text
    assert 'Server-Timing' in response.headers
    for url in re.findall(r'(?:src|href)="(/app/[^\"]+\.(?:js|css))"', response.text):
        resource = client.get(url)
        assert resource.status_code == 200, url
        assert 'text/html' not in resource.headers['content-type'], url
        if '/assets/' in url:
            assert 'immutable' in resource.headers['cache-control']
        else:
            assert 'immutable' not in resource.headers['cache-control']
    assert client.get('/app/assets/missing-chunk.js').status_code == 404


def test_cookie_authentication_does_not_query_session_twice():
    client = TestClient(app)
    result = client.post('/api/auth/register', json={'username': 'auth_query_qa',
        'email': 'auth_query_qa@example.com', 'password': 'password123', 'confirm_password': 'password123'})
    assert result.status_code == 201
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(test_engine, 'before_cursor_execute', capture)
    try:
        assert client.get('/api/auth/me').status_code == 200
    finally:
        event.remove(test_engine, 'before_cursor_execute', capture)
    assert sum('FROM user_sessions' in statement for statement in statements) == 1
