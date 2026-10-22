from uuid import UUID

from fastapi import APIRouter, Depends, Response, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.models.project import IssueStatus, TaskStatus
from app.schemas.project import (
    CodeRepoCreate,
    CodeRepoResponse,
    CommitCreate,
    CommitResponse,
    IssueCreate,
    IssueResponse,
    IssueUpdate,
    RepoFileCreate,
    RepoFileResponse,
    RepoFileUpdate,
    TaskCreate,
    TaskResponse,
    TaskUpdate,
)
from app.services.project_service import (
    create_commit,
    create_issue,
    create_repo,
    create_task,
    delete_repo_file,
    delete_task,
    get_repo,
    get_task,
    list_commits,
    list_issues,
    list_repo_files,
    list_repos,
    list_tasks,
    save_repo_file,
    update_issue,
    update_task,
)
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



# --- Code Repositories ---

@router.get("/repos", response_model=list[CodeRepoResponse])
async def get_repos(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[CodeRepoResponse]:
    repos = await list_repos(db, workspace_id, current_user.id)
    return [CodeRepoResponse.model_validate(repo) for repo in repos]


@router.post("/repos", response_model=CodeRepoResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace_repo(
    workspace_id: UUID,
    data: CodeRepoCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> CodeRepoResponse:
    repo = await create_repo(db, workspace_id, current_user, data)
    return CodeRepoResponse.model_validate(repo)


@router.get("/repos/{repo_id}", response_model=CodeRepoResponse)
async def get_workspace_repo(
    workspace_id: UUID,
    repo_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> CodeRepoResponse:
    repo = await get_repo(db, workspace_id, repo_id, current_user.id)
    return CodeRepoResponse.model_validate(repo)


# --- Commits ---

@router.get("/repos/{repo_id}/commits", response_model=list[CommitResponse])
async def get_repo_commits(
    workspace_id: UUID,
    repo_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[CommitResponse]:
    commits = await list_commits(db, workspace_id, repo_id, current_user.id)
    return [CommitResponse.model_validate(commit) for commit in commits]


@router.post("/repos/{repo_id}/commits", response_model=CommitResponse, status_code=status.HTTP_201_CREATED)
async def create_repo_commit(
    workspace_id: UUID,
    repo_id: UUID,
    data: CommitCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> CommitResponse:
    commit = await create_commit(db, workspace_id, repo_id, current_user, data)
    return CommitResponse.model_validate(commit)


# --- Issues ---

@router.get("/repos/{repo_id}/issues", response_model=list[IssueResponse])
async def get_repo_issues(
    workspace_id: UUID,
    repo_id: UUID,
    status: IssueStatus | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[IssueResponse]:
    issues = await list_issues(db, workspace_id, repo_id, current_user.id, status=status)
    return [IssueResponse.model_validate(issue) for issue in issues]


@router.post("/repos/{repo_id}/issues", response_model=IssueResponse, status_code=status.HTTP_201_CREATED)
async def create_repo_issue(
    workspace_id: UUID,
    repo_id: UUID,
    data: IssueCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> IssueResponse:
    issue = await create_issue(db, workspace_id, repo_id, current_user, data)
    return IssueResponse.model_validate(issue)


@router.patch("/repos/{repo_id}/issues/{issue_id}", response_model=IssueResponse)
async def update_repo_issue(
    workspace_id: UUID,
    repo_id: UUID,
    issue_id: UUID,
    data: IssueUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> IssueResponse:
    issue = await update_issue(db, workspace_id, repo_id, issue_id, current_user.id, data)
    return IssueResponse.model_validate(issue)


# --- Code Repository Files ---

@router.get("/repos/{repo_id}/files", response_model=list[RepoFileResponse])
async def get_repo_files(
    workspace_id: UUID,
    repo_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[RepoFileResponse]:
    files = await list_repo_files(db, workspace_id, repo_id, current_user.id)
    return [RepoFileResponse.model_validate(f) for f in files]


@router.post("/repos/{repo_id}/files", response_model=RepoFileResponse, status_code=status.HTTP_201_CREATED)
async def create_or_save_repo_file(
    workspace_id: UUID,
    repo_id: UUID,
    data: RepoFileCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> RepoFileResponse:
    file_record = await save_repo_file(db, workspace_id, repo_id, current_user, data)
    return RepoFileResponse.model_validate(file_record)


@router.delete("/repos/{repo_id}/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_repo_file_endpoint(
    workspace_id: UUID,
    repo_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> Response:
    await delete_repo_file(db, workspace_id, repo_id, file_id, current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

