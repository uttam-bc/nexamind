import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.models.ai import AiSession, AiMessage
from app.services.agent_orchestrator import run_agent
from app.services.memory_engine import run_full_workspace_ingestion, get_workspace_memory_stats
from app.services.auth_service import AuthError
from app.services.workspace_service import get_workspace_membership
import httpx
import os

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces/{workspace_id}/ai", tags=["ai_agent"])


# -------------------------------------------------------------
# SCHEMAS
# -------------------------------------------------------------

class AgentChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    session_id: UUID | None = None
    gemini_key: str | None = None


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


class GeminiKeyTestRequest(BaseModel):
    api_key: str | None = None


# -------------------------------------------------------------
# CHAT EXECUTION
# -------------------------------------------------------------

@router.post("/chat", response_model=AgentChatResponse, status_code=status.HTTP_200_OK)
async def chat_with_agent(
    workspace_id: UUID,
    request: AgentChatRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AgentChatResponse:
    membership = await get_workspace_membership(db, workspace_id, current_user.id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)

    try:
        result = await run_agent(
            db=db,
            workspace_id=workspace_id,
            user=current_user,
            user_prompt=request.prompt,
            session_id=request.session_id,
            gemini_key_override=request.gemini_key,
        )
        return AgentChatResponse.model_validate(result)
    except Exception as exc:
        logger.exception("Agent chat execution error: %s", exc)
        return AgentChatResponse(
            session_id=str(request.session_id or ""),
            session_title="Error",
            response=f"⚠️ Encountered an issue while executing your request: {str(exc)}",
            tool_calls=[],
            retrieved_memories=[],
        )


# -------------------------------------------------------------
# SESSIONS MANAGEMENT
# -------------------------------------------------------------

@router.get("/sessions", response_model=list[SessionSummary])
async def list_chat_sessions(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SessionSummary]:
    membership = await get_workspace_membership(db, workspace_id, current_user.id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)

    q = (
        select(AiSession)
        .where(
            AiSession.workspace_id == workspace_id,
            AiSession.user_id == current_user.id,
        )
        .order_by(AiSession.updated_at.desc())
    )
    res = await db.execute(q)
    sessions = list(res.scalars().all())

    summaries = []
    for s in sessions:
        count_q = select(AiMessage.id).where(AiMessage.session_id == s.id)
        msg_count = len((await db.execute(count_q)).scalars().all())
        summaries.append(
            SessionSummary(
                id=s.id,
                title=s.title,
                created_at=s.created_at.isoformat() if s.created_at else "",
                updated_at=s.updated_at.isoformat() if s.updated_at else "",
                message_count=msg_count,
            )
        )
    return summaries


@router.post("/sessions", response_model=SessionSummary)
async def create_chat_session(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionSummary:
    membership = await get_workspace_membership(db, workspace_id, current_user.id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)

    new_session = AiSession(
        workspace_id=workspace_id,
        user_id=current_user.id,
        title="New Chat Session",
    )
    db.add(new_session)
    await db.commit()
    await db.refresh(new_session)

    return SessionSummary(
        id=new_session.id,
        title=new_session.title,
        created_at=new_session.created_at.isoformat(),
        updated_at=new_session.updated_at.isoformat(),
        message_count=0,
    )


@router.get("/sessions/{session_id}", response_model=list[MessageDetail])
async def get_session_messages(
    workspace_id: UUID,
    session_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MessageDetail]:
    membership = await get_workspace_membership(db, workspace_id, current_user.id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)

    q = (
        select(AiMessage)
        .where(AiMessage.session_id == session_id)
        .order_by(AiMessage.created_at.asc())
    )
    res = await db.execute(q)
    messages = list(res.scalars().all())

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
):
    membership = await get_workspace_membership(db, workspace_id, current_user.id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)

    q = select(AiSession).where(
        AiSession.id == session_id,
        AiSession.workspace_id == workspace_id,
        AiSession.user_id == current_user.id,
    )
    session_obj = (await db.execute(q)).scalar_one_or_none()
    if session_obj:
        await db.delete(session_obj)
        await db.commit()


# -------------------------------------------------------------
# MEMORY ENGINE STATS & RE-INDEXING
# -------------------------------------------------------------

@router.get("/memory/stats")
async def get_memory_pipeline_stats(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    membership = await get_workspace_membership(db, workspace_id, current_user.id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)

    return await get_workspace_memory_stats(db, workspace_id)


@router.post("/memory/reindex")
async def trigger_memory_reindex(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    membership = await get_workspace_membership(db, workspace_id, current_user.id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)

    return await run_full_workspace_ingestion(db, workspace_id)


# -------------------------------------------------------------
# GEMINI API KEY VALIDATION / TEST
# -------------------------------------------------------------

async def _verify_gemini_key(clean_key: str) -> dict:
    payload = {
        "contents": [{"parts": [{"text": "Hello, respond with OK"}]}],
        "generationConfig": {"maxOutputTokens": 10},
    }
    timeout_config = httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0)
    for model in ["gemini-3.8-flash", "gemini-3-flash-preview", "gemini-flash-lite-latest", "gemini-flash-latest"]:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={clean_key}"
        try:
            async with httpx.AsyncClient(timeout=timeout_config) as client:
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    return {
                        "status": "success",
                        "ok": True,
                        "valid": True,
                        "model": model,
                        "message": f"Connected to Google Gemini ({model}) successfully!",
                    }
        except Exception:
            continue

    return {
        "status": "error",
        "ok": False,
        "valid": False,
        "error": "Could not connect to Gemini API with this key. Please check the key validity.",
        "message": "Could not connect to Gemini API with this key.",
    }


@router.post("/config/test-gemini")
async def test_gemini_key(
    workspace_id: UUID,
    request: GeminiKeyTestRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    membership = await get_workspace_membership(db, workspace_id, current_user.id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)

    key = request.api_key or os.getenv("GEMINI_API_KEY")
    if not key or not key.strip():
        return {"status": "error", "ok": False, "valid": False, "message": "No API key provided or configured."}

    return await _verify_gemini_key(key.strip())


global_ai_router = APIRouter(prefix="/ai", tags=["ai_global"])

@global_ai_router.post("/config/test-gemini")
async def test_gemini_key_global(
    request: GeminiKeyTestRequest,
    current_user: User = Depends(get_current_user),
) -> dict:
    key = request.api_key or os.getenv("GEMINI_API_KEY")
    if not key or not key.strip():
        return {"status": "error", "ok": False, "valid": False, "message": "No API key provided or configured."}

    return await _verify_gemini_key(key.strip())
