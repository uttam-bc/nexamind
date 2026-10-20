import ssl
from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()


def postgres_connect_args(database_url: str) -> dict:
    """Build asyncpg connect_args. Render internal URLs need no SSL; external need TLS."""
    if "postgresql" not in database_url:
        return {}
    args: dict = {
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
    }
    # External Render hostname only — internal (dpg-… / private) stays on the private network.
    if "render.com" in database_url:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        args["ssl"] = ctx
    return args


connect_args = postgres_connect_args(settings.database_url)

engine = create_async_engine(
    settings.database_url,
    echo=False,
    future=True,
    pool_pre_ping="postgresql" in settings.database_url,
    connect_args=connect_args,
)


def enable_sqlite_foreign_keys(sync_engine) -> None:
    """SQLite ignores ON DELETE CASCADE unless foreign keys are switched on per connection."""
    if sync_engine.dialect.name != "sqlite":
        return

    @event.listens_for(sync_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


enable_sqlite_foreign_keys(engine.sync_engine)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
