import asyncio
import os
from collections.abc import AsyncGenerator, Generator

# Configure before the app is imported: tests never call real AI providers or use .env secrets.
os.environ.update({
    "APP_ENV": "test",
    "GEMINI_API_KEY": "",
    "GROQ_API_KEY": "",
    "REDIS_URL": "",
    "RATE_LIMIT_ENABLED": "false",
    "RUN_BACKGROUND_JOBS": "false",
    "AUTO_CREATE_SCHEMA": "false",
    # Fixtures register users directly; OTP flows are tested with verification switched on.
    "REQUIRE_EMAIL_VERIFICATION": "false",
    # Dev auth returns OTP codes in responses and accepts mock Google credentials (test only).
    "ENABLE_DEV_AUTH": "true",
    "SMTP_HOST": "",
    "GOOGLE_CLIENT_ID": "",
    "UPLOAD_DIR": os.path.join(os.path.dirname(__file__), ".test_uploads"),
    "REPO_DIR": os.path.join(os.path.dirname(__file__), ".test_repos"),
})

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from sqlalchemy.pool import StaticPool

import app.database as app_db
from app.database import Base, enable_sqlite_foreign_keys, get_db
from app.main import app
from app.security import rate_limiter
from app.services import llm_client

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(
        TEST_DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    enable_sqlite_foreign_keys(engine.sync_engine)
    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
        autocommit=False,
    )

    old_factory = app_db.AsyncSessionLocal
    old_engine = app_db.engine
    app_db.AsyncSessionLocal = session_factory
    app_db.engine = engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with session_factory() as session:
        yield session

    app_db.AsyncSessionLocal = old_factory
    app_db.engine = old_engine
    await engine.dispose()




@pytest.fixture(autouse=True)
def _reset_rate_limits() -> None:
    rate_limiter.reset()
    llm_client.reset_model_health()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        try:
            yield db_session
            await db_session.commit()
        except Exception:
            await db_session.rollback()
            raise

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def auth_context(client: AsyncClient) -> dict:
    response = await client.post(
        "/auth/register",
        json={
            "email": "testuser@example.com",
            "password": "securepass123",
            "name": "Test User",
        },
    )
    assert response.status_code == 201
    data = response.json()
    workspaces = await client.get(
        "/workspaces",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    return {
        "token": data["access_token"],
        "user_id": data["user"]["id"],
        "workspace_id": workspaces.json()[0]["id"],
    }


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
