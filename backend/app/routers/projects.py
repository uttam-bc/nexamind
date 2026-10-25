from uuid import UUID

from fastapi import APIRouter, Depends, Response, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.models.project import TaskStatus
from app.schemas.project import TaskCreate, TaskResponse, TaskUpdate
from app.services.project_service import create_task, delete_task, get_task, list_tasks, update_task
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["projects"])


# --- Tasks (Kanban Board) ---

@router.get("/tasks", response_model=list[TaskResponse])
async def get_tasks(
    workspace_id: UUID,
    status: TaskStatus | None = None,
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[TaskResponse]:
    tasks = await list_tasks(db, workspace_id, current_user.id, status=status, limit=limit, offset=offset)
    return [TaskResponse.model_validate(task) for task in tasks]


@router.post("/tasks", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace_task(
    workspace_id: UUID,
    data: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> TaskResponse:
    task = await create_task(db, workspace_id, current_user, data)
    task_data = TaskResponse.model_validate(task).model_dump(mode="json")
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "task_created", "workspace_id": str(workspace_id), "data": task_data},
    )
    return TaskResponse.model_validate(task)


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_workspace_task(
    workspace_id: UUID,
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> TaskResponse:
    task = await get_task(db, workspace_id, task_id, current_user.id)
    return TaskResponse.model_validate(task)


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_workspace_task(
    workspace_id: UUID,
    task_id: UUID,
    data: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> TaskResponse:
    task = await update_task(db, workspace_id, task_id, current_user.id, data)
    task_data = TaskResponse.model_validate(task).model_dump(mode="json")
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "task_updated", "workspace_id": str(workspace_id), "data": task_data},
    )
    return TaskResponse.model_validate(task)


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_task(
    workspace_id: UUID,
    task_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> Response:
    await delete_task(db, workspace_id, task_id, current_user.id)
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "task_deleted", "workspace_id": str(workspace_id), "task_id": str(task_id)},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
