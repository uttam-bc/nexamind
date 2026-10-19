"""In-process app with a fresh in-memory database, shared by the evaluation scripts.

Importing this module does not change environment variables; callers set them first.
"""

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.database as app_db
import app.models  # noqa: F401
from app.database import Base, enable_sqlite_foreign_keys
from app.main import app


class Harness:
    async def __aenter__(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool,
                                          connect_args={"check_same_thread": False})
        enable_sqlite_foreign_keys(self.engine.sync_engine)
        factory = async_sessionmaker(bind=self.engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)
        app_db.AsyncSessionLocal = factory
        app_db.engine = self.engine
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.client = AsyncClient(transport=ASGITransport(app=app), base_url="http://eval")
        return self

    async def __aexit__(self, *exc):
        await self.client.aclose()
        await self.engine.dispose()

    async def user(self, handle: str) -> dict:
        res = await self.client.post("/auth/register", json={
            "email": f"{handle}@example.com", "password": "evalpass123", "name": handle.title(), "username": handle})
        token = res.json()["access_token"]
        ws = await self.client.get("/workspaces", headers=self.h(token))
        return {"token": token, "id": res.json()["user"]["id"], "username": handle, "personal": ws.json()[0]["id"]}

    @staticmethod
    def h(token: str) -> dict:
        return {"Authorization": f"Bearer {token}"}
