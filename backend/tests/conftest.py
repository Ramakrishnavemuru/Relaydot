import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.database import Base, get_db
from app.main import app
from app.services.rate_limit import _hits

TEST_DATABASE_URL = "sqlite:///:memory:"

test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(autouse=True)
def setup_and_teardown_db(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "WS_ALLOW_QUERY_TOKENS", True)
    _hits.clear()
    Base.metadata.create_all(bind=test_engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=test_engine)


from fastapi.testclient import TestClient as RawTestClient


class BrowserTestClient(RawTestClient):
    """Exercise cookie clients with the same CSRF header flow as the frontend."""
    def request(self, method, url, **kwargs):
        if method.upper() not in {"GET", "HEAD", "OPTIONS"}:
            headers = dict(kwargs.get("headers") or {})
            if not any(key.lower() == "authorization" for key in headers):
                response = super().request("GET", "/api/auth/csrf")
                if response.status_code == 200:
                    headers["X-CSRF-Token"] = response.json()["csrf_token"]
                elif response.status_code == 401:
                    self.cookies.clear()
            kwargs["headers"] = headers
        return super().request(method, url, **kwargs)
