from fastapi.testclient import TestClient
from app.main import app, client_dist


client = TestClient(app)


def test_react_frontend_routes_and_no_legacy_mount():
    if not client_dist.exists():
        return
    assert client.get("/", follow_redirects=False).headers["location"] == "/app/"
    assert client.get("/app/chats").status_code == 200
    assert client.get("/app/communities/1").status_code == 200
    assert client.get("/legacy/social.html").status_code == 404


def test_old_deep_links_redirect_to_react():
    if not client_dist.exists():
        return
    expected = {
        "/social.html?view=post&id=7": "/app/posts/7",
        "/social.html?view=community&id=3": "/app/communities/3",
        "/chat.html?conversation=8": "/app/chats?id=8",
        "/reels.html?id=abc": "/app/reels?id=abc",
        "/settings.html": "/app/settings",
    }
    for url, target in expected.items():
        response = client.get(url, follow_redirects=False)
        assert response.status_code == 307
        assert response.headers["location"] == target
