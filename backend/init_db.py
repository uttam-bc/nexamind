import asyncio
import logging
from app.database import Base, engine
import app.models  # noqa: F401

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def init_schema():
    logger.info("Connecting to database and creating all missing tables...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("All tables created successfully!")

if __name__ == "__main__":
    asyncio.run(init_schema())
