import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.models.ai import AiMessage, AiSession
from app.security import decrypt_secret, encrypt_secret, limit_ai
from app.services import llm_client
from app.services.agent_orchestrator import run_agent
from app.services.auth_service import AuthError
from app.services.memory_engine import get_workspace_memory_stats, run_full_workspace_ingestion
from app.services.workspace_service import get_workspace_membership

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces/{workspace_id}/ai", tags=["ai_agent"])
global_ai_router = APIRouter(prefix="/ai", tags=["ai_global"])


class AgentChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=8000)
    session_id: UUID | None = None


class ToolCallLog(BaseModel):
    tool: str
    args: dict = Field(default_factory=dict)
    result: dict = Field(default_factory=dict)


class AgentChatResponse(BaseModel):
    session_id: str
    session_title: str
    response: str
    tool_calls: list[ToolCallLog] = Field(default_factory=list)
    retrieved_memories: list[dict] = Field(default_factory=list)


class SessionSummary(BaseModel):
    id: UUID
    title: str
    created_at: str
    updated_at: str
    message_count: int = 0


class MessageDetail(BaseModel):
    id: UUID
    role: str
    content: str
    tool_calls: list[dict] = Field(default_factory=list)
    retrieved_memories: list[dict] = Field(default_factory=list)
    created_at: str


class GeminiKeyRequest(BaseModel):
    api_key: str | None = Field(default=None, max_length=200)


class AiConfigResponse(BaseModel):
    has_personal_key: bool
    personal_key_hint: str | None = None
    server_gemini_available: bool
    server_groq_available: bool


async def _require_member(db: AsyncSession, workspace_id: UUID, user: User) -> None:
    if not await get_workspace_membership(db, workspace_id, user.id):
        raise AuthError("Workspace not found or access denied", status_code=404)


async def _own_session(db: AsyncSession, workspace_id: UUID, session_id: UUID, user: User) -> AiSession:
    session = (await db.execute(
        select(AiSession).where(
            AiSession.id == session_id,
            AiSession.workspace_id == workspace_id,
            AiSession.user_id == user.id,
        )
    )).scalar_one_or_none()
    if session is None:
        raise AuthError("Chat session not found", status_code=404)
    return session


# -------------------------------------------------------------------------------------------
# Chat
# -------------------------------------------------------------------------------------------

@router.post("/chat", response_model=AgentChatResponse, dependencies=[Depends(limit_ai)])
async def chat_with_agent(
    workspace_id: UUID,
    request: AgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AgentChatResponse:
    await _require_member(db, workspace_id, current_user)
    result = await run_agent(
        db=db,
        workspace_id=workspace_id,
        user=current_user,
        user_prompt=request.prompt,
        session_id=request.session_id,
    )
    return AgentChatResponse.model_validate(result)


@router.get("/sessions", response_model=list[SessionSummary])
async def list_chat_sessions(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SessionSummary]:
    await _require_member(db, workspace_id, current_user)
    message_counts = (
        select(AiMessage.session_id, func.count(AiMessage.id).label("n"))
        .group_by(AiMessage.session_id)
        .subquery()
    )
    rows = (await db.execute(
        select(AiSession, func.coalesce(message_counts.c.n, 0))
        .outerjoin(message_counts, message_counts.c.session_id == AiSession.id)
        .where(AiSession.workspace_id == workspace_id, AiSession.user_id == current_user.id)
        .order_by(AiSession.updated_at.desc())
    )).all()
    return [
        SessionSummary(
            id=s.id,
            title=s.title,
            created_at=s.created_at.isoformat() if s.created_at else "",
            updated_at=s.updated_at.isoformat() if s.updated_at else "",
            message_count=count,
        )
        for s, count in rows
    ]


@router.post("/sessions", response_model=SessionSummary)
async def create_chat_session(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionSummary:
    await _require_member(db, workspace_id, current_user)
    session = AiSession(workspace_id=workspace_id, user_id=current_user.id, title="New chat")
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return SessionSummary(
        id=session.id,
        title=session.title,
        created_at=session.created_at.isoformat(),
        updated_at=session.updated_at.isoformat(),
        message_count=0,
    )


@router.get("/sessions/{session_id}", response_model=list[MessageDetail])
async def get_session_messages(
    workspace_id: UUID,
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MessageDetail]:
    await _require_member(db, workspace_id, current_user)
    session = await _own_session(db, workspace_id, session_id, current_user)
    messages = (await db.execute(
        select(AiMessage).where(AiMessage.session_id == session.id).order_by(AiMessage.created_at.asc())
    )).scalars().all()
    return [
        MessageDetail(
            id=m.id,
            role=m.role,
            content=m.content,
            tool_calls=m.tool_calls or [],
            retrieved_memories=m.retrieved_memories or [],
            created_at=m.created_at.isoformat() if m.created_at else "",
        )
        for m in messages
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chat_session(
    workspace_id: UUID,
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await _require_member(db, workspace_id, current_user)
    session = await _own_session(db, workspace_id, session_id, current_user)
    await db.delete(session)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -------------------------------------------------------------------------------------------
# Memory
# -------------------------------------------------------------------------------------------

@router.get("/memory/stats")
async def get_memory_pipeline_stats(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _require_member(db, workspace_id, current_user)
    return await get_workspace_memory_stats(db, workspace_id)


@router.post("/memory/reindex", dependencies=[Depends(limit_ai)])
async def trigger_memory_reindex(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _require_member(db, workspace_id, current_user)
    return await run_full_workspace_ingestion(db, workspace_id, gemini_key=llm_client.resolve_gemini_key(current_user))


# -------------------------------------------------------------------------------------------
# Personal Gemini key (stored encrypted on the server, never returned to the browser)
# -------------------------------------------------------------------------------------------

async def _verify_gemini_key(key: str) -> dict:
    try:
        candidate = await llm_client.gemini_generate(
            key,
            [{"role": "user", "parts": [{"text": "Reply with OK"}]}],
            generation_config={"maxOutputTokens": 5},
        )
    except llm_client.LlmKeyError:
        return {"ok": False, "valid": False, "message": "Google rejected this API key."}
    if candidate is None:
        return {"ok": False, "valid": False, "message": "Could not reach Gemini with this key. Try again later."}
    return {"ok": True, "valid": True, "message": "Gemini key works."}


def _config_for(user: User) -> AiConfigResponse:
    settings = get_settings()
    personal = decrypt_secret(user.gemini_api_key_encrypted)
    return AiConfigResponse(
        has_personal_key=bool(personal),
        personal_key_hint=f"…{personal[-4:]}" if personal else None,
        server_gemini_available=bool((settings.gemini_api_key or "").strip()),
        server_groq_available=bool((settings.groq_api_key or "").strip()),
    )


@global_ai_router.get("/config", response_model=AiConfigResponse)
async def get_ai_config(current_user: User = Depends(get_current_user)) -> AiConfigResponse:
    return _config_for(current_user)


@global_ai_router.put("/config/gemini-key", response_model=AiConfigResponse, dependencies=[Depends(limit_ai)])
async def save_gemini_key(
    request: GeminiKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AiConfigResponse:
    key = (request.api_key or "").strip()
    if not key:
        raise AuthError("Enter an API key", status_code=400)
    result = await _verify_gemini_key(key)
    if not result["valid"]:
        raise AuthError(result["message"], status_code=400)
    current_user.gemini_api_key_encrypted = encrypt_secret(key)
    await db.flush()
    return _config_for(current_user)


@global_ai_router.delete("/config/gemini-key", response_model=AiConfigResponse)
async def delete_gemini_key(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AiConfigResponse:
    current_user.gemini_api_key_encrypted = None
    await db.flush()
    return _config_for(current_user)


@global_ai_router.post("/config/test-gemini", dependencies=[Depends(limit_ai)])
async def test_gemini_key_global(
    request: GeminiKeyRequest,
    current_user: User = Depends(get_current_user),
) -> dict:
    key = (request.api_key or "").strip() or llm_client.resolve_gemini_key(current_user)
    if not key:
        return {"ok": False, "valid": False, "message": "No API key provided or configured."}
    return await _verify_gemini_key(key)


@router.post("/config/test-gemini", dependencies=[Depends(limit_ai)])
async def test_gemini_key(
    workspace_id: UUID,
    request: GeminiKeyRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await _require_member(db, workspace_id, current_user)
    return await test_gemini_key_global(request, current_user)
