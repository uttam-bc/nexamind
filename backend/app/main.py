import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import Base, engine
from app.routers import (
    ai_agent,
    auth,
    calendar,
    channels,
    documents,
    files,
    finance,
    projects,
    reports,
    sessions,
    video,
    websockets,
    workspaces,
)
from app.services.auth_service import AuthError

settings = get_settings()

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    try:
        import app.models  # noqa: F401 - Register all database models
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database schema initialized and verified")
    except Exception as e:
        logger.warning("Database schema auto-sync warning: %s", e)
    yield


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="NexaMind backend API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AuthError)
async def auth_error_handler(_: Request, exc: AuthError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.get("/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


app.include_router(auth.router)
app.include_router(workspaces.router)
app.include_router(documents.router)
app.include_router(projects.router)
app.include_router(files.router)
app.include_router(finance.router)
app.include_router(channels.router)
app.include_router(websockets.router)
app.include_router(sessions.router)
app.include_router(ai_agent.router)
app.include_router(reports.router)
app.include_router(video.router)
app.include_router(calendar.router)





