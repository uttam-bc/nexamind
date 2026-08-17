from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.workspace import (
    WorkspaceCreate,
    WorkspaceDetailResponse,
    WorkspaceJoin,
    WorkspaceResponse,
)
from app.services.workspace_service import (
    create_team_workspace,
    get_workspace_for_user,
    join_workspace_by_code,
    list_user_workspaces,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@router.get("", response_model=list[WorkspaceResponse])
async def list_workspaces(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WorkspaceResponse]:
    workspaces = await list_user_workspaces(db, current_user.id)
    return [WorkspaceResponse.model_validate(workspace) for workspace in workspaces]


@router.post("", response_model=WorkspaceResponse, status_code=201)
async def create_workspace(
    data: WorkspaceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceResponse:
    workspace = await create_team_workspace(db, current_user, data.name)
    return WorkspaceResponse.model_validate(workspace)


@router.get("/{workspace_id}", response_model=WorkspaceDetailResponse)
async def get_workspace(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceDetailResponse:
    workspace = await get_workspace_for_user(db, workspace_id, current_user.id)
    return WorkspaceDetailResponse.model_validate(workspace)


@router.post("/join", response_model=WorkspaceResponse)
async def join_workspace(
    data: WorkspaceJoin,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceResponse:
    workspace = await join_workspace_by_code(db, current_user, data.join_code)
    return WorkspaceResponse.model_validate(workspace)
