from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.services.agent_orchestrator import run_agent
from app.services.auth_service import AuthError
from app.services.workspace_service import get_workspace_membership

router = APIRouter(prefix="/workspaces/{workspace_id}/ai", tags=["ai_agent"])


class AgentChatRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)


class ToolCallLog(BaseModel):
    tool: str
    args: dict
    result: dict


class AgentChatResponse(BaseModel):
    response: str
    tool_calls: list[ToolCallLog] = Field(default_factory=list)


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
        )
        return AgentChatResponse.model_validate(result)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).exception("Agent chat execution error: %s", exc)
        return AgentChatResponse(
            response=f"⚠️ Encountered an issue while executing your request: {str(exc)}",
            tool_calls=[],
        )
