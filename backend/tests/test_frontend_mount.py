from fastapi.testclient import TestClient
from app.main import app, client_dist
import re


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


def test_frontend_cache_policy_and_api_compression():
    if not client_dist.exists():
        return
    page = client.get("/app/chats")
    assert page.headers["cache-control"] == "no-cache"
    assets = list((client_dist / "assets").glob("*"))
    hashed_asset = next((asset for asset in assets if re.search(r"-[A-Za-z0-9_-]{8,}\.", asset.name)), None)
    assert hashed_asset is not None
    asset = client.get(f"/app/assets/{hashed_asset.name}")
    assert asset.status_code == 200
    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    schema = client.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert schema.status_code == 200
    assert schema.headers.get("content-encoding") == "gzip"
