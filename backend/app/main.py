import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import database
from app.config import get_settings
from app.monitoring import init_monitoring
from app.routers import (
    ai_agent,
    auth,
    calendar,
    contact,
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
from app.security import SecurityHeadersMiddleware
from app.services.auth_service import AuthError
from app.services.session_service import resume_interrupted_sessions
from app.services.websocket_manager import ws_manager

settings = get_settings()

logging.basicConfig(level=settings.log_level)
init_monitoring(settings.sentry_dsn, settings.app_env)
logger = logging.getLogger(__name__)
# httpx logs full request URLs at INFO; keep provider calls out of the logs.
logging.getLogger("httpx").setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if settings.auto_create_schema:
        import app.models  # noqa: F401 - register all models

        async with database.engine.begin() as conn:
            await conn.run_sync(database.Base.metadata.create_all)
        logger.info("Database tables created (AUTO_CREATE_SCHEMA). Use Alembic migrations in production.")

    if not settings.auto_create_schema:
        # NX-BUG-008: an out-of-date database otherwise shows up later as confusing 500 errors.
        try:
            current, head = await database.schema_revision_status()
            if current != head:
                logger.error(
                    "Database schema is at revision %s but the code expects %s. "
                    "Run `alembic upgrade head` in backend/ (start_nexamind.bat does this).",
                    current, head,
                )
        except Exception as exc:
            logger.warning("Could not check the database migration revision: %s", exc)

    await ws_manager.start()
    if settings.run_background_jobs:
        try:
            await resume_interrupted_sessions()
        except Exception as exc:
            logger.warning("Could not resume interrupted recordings: %s", exc)
    yield
    await ws_manager.stop()


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="NexaMind backend API",
    lifespan=lifespan,
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
    openapi_url="/openapi.json" if settings.is_development else None,
)

app.add_middleware(SecurityHeadersMiddleware, enable_hsts=not settings.is_development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,  # auth uses bearer tokens, not cookies
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(AuthError)
async def auth_error_handler(_: Request, exc: AuthError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    if settings.debug:
        return JSONResponse(status_code=500, content={"detail": str(exc), "type": type(exc).__name__})
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.api_route("/health", methods=["GET", "HEAD"])
async def health_check() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}


for module in (auth, contact, workspaces, documents, projects, files, finance, channels, websockets, sessions,
               ai_agent, reports, video, calendar):
    app.include_router(module.router)
app.include_router(ai_agent.global_ai_router)
