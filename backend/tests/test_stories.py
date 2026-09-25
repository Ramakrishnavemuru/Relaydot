import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_story_lifecycle():
    # User 1: Author
    u1 = client.post("/api/auth/register", json={
        "username": "story_author",
        "email": "author@example.com",
        "password": "password123",
        "confirm_password": "password123",
        "display_name": "Author"
    }).json()
    token1 = u1["access_token"]
    u1_id = u1["user"]["id"]

    # User 2: Viewer
    u2 = client.post("/api/auth/register", json={
        "username": "story_viewer",
        "email": "viewer@example.com",
        "password": "password123",
        "confirm_password": "password123",
        "display_name": "Viewer"
    }).json()
    token2 = u2["access_token"]
    u2_id = u2["user"]["id"]

    # 1. Post a new story
    post_res = client.post(
        "/api/stories",
        headers={"Authorization": f"Bearer {token1}"},
        json={
            "media_url": "/uploads/sample_story.jpg",
            "media_type": "IMAGE",
            "caption": "Beautiful Sunset at the beach!"
        }
    )
    assert post_res.status_code == 201
    story_data = post_res.json()
    story_id = story_data["id"]
    assert story_data["caption"] == "Beautiful Sunset at the beach!"
    assert story_data["is_own"] is True
    assert story_data["views_count"] == 0

    # 2. Viewer lists active stories
    list_res = client.get(
        "/api/stories",
        headers={"Authorization": f"Bearer {token2}"}
    )
    assert list_res.status_code == 200
    groups = list_res.json()
    assert len(groups) >= 1
    author_group = next((g for g in groups if g["user_id"] == u1_id), None)
    assert author_group is not None
    assert author_group["all_viewed"] is False
    assert len(author_group["stories"]) == 1

    # 3. Viewer records view
    view_res = client.post(
        f"/api/stories/{story_id}/view",
        headers={"Authorization": f"Bearer {token2}"}
    )
    assert view_res.status_code == 200
    assert view_res.json()["viewed"] is True

    # 4. Author checks who viewed the story
    views_res = client.get(
        f"/api/stories/{story_id}/views",
        headers={"Authorization": f"Bearer {token1}"}
    )
    assert views_res.status_code == 200
    viewers = views_res.json()
    assert len(viewers) == 1
    assert viewers[0]["viewer_id"] == u2_id

    # 5. Viewer replies to the story
    reply_res = client.post(
        f"/api/stories/{story_id}/reply",
        headers={"Authorization": f"Bearer {token2}"},
        json={"content": "Looks amazing!"}
    )
    assert reply_res.status_code == 200

    # Verify a message was generated in direct conversation
    convs = client.get("/api/conversations", headers={"Authorization": f"Bearer {token1}"}).json()
    assert len(convs) >= 1
    assert "Looks amazing!" in convs[0]["last_message"]["content"]

    # 6. Author deletes the story
    del_res = client.delete(
        f"/api/stories/{story_id}",
        headers={"Authorization": f"Bearer {token1}"}
    )
    assert del_res.status_code == 200
