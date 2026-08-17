import secrets
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CodeRepo, Commit, Issue, Task, User
from app.models.project import IssueStatus, TaskStatus
from app.schemas.project import (
    CodeRepoCreate,
    CommitCreate,
    IssueCreate,
    IssueUpdate,
    TaskCreate,
    TaskUpdate,
)
from app.services.auth_service import AuthError
from app.services.workspace_service import get_workspace_membership


async def list_tasks(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    status: TaskStatus | None = None,
) -> list[Task]:
    await _require_workspace_access(db, workspace_id, user_id)
    query = select(Task).where(Task.workspace_id == workspace_id)
    if status is not None:
        query = query.where(Task.status == status)
    query = query.order_by(Task.position.asc(), Task.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_task(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    data: TaskCreate,
) -> Task:
    await _require_workspace_access(db, workspace_id, user.id)
    task = Task(
        workspace_id=workspace_id,
        title=data.title.strip(),
        description=data.description.strip() if data.description else None,
        status=data.status,
        position=data.position,
        priority=data.priority,
        assignee_id=data.assignee_id,
        due_date=data.due_date,
        created_by=user.id,
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    return task


async def get_task(
    db: AsyncSession,
    workspace_id: UUID,
    task_id: UUID,
    user_id: UUID,
) -> Task:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.workspace_id == workspace_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise AuthError("Task not found", status_code=404)
    return task


async def update_task(
    db: AsyncSession,
    workspace_id: UUID,
    task_id: UUID,
    user_id: UUID,
    data: TaskUpdate,
) -> Task:
    task = await get_task(db, workspace_id, task_id, user_id)
    if data.title is not None:
        task.title = data.title.strip()
    if data.description is not None:
        task.description = data.description.strip() if data.description else None
    if data.status is not None:
        task.status = data.status
    if data.position is not None:
        task.position = data.position
    if data.priority is not None:
        task.priority = data.priority
    if data.assignee_id is not None:
        task.assignee_id = data.assignee_id
    if data.due_date is not None:
        task.due_date = data.due_date

    await db.flush()
    await db.refresh(task)
    return task


async def delete_task(
    db: AsyncSession,
    workspace_id: UUID,
    task_id: UUID,
    user_id: UUID,
) -> None:
    task = await get_task(db, workspace_id, task_id, user_id)
    await db.delete(task)
    await db.flush()


# --- Code Repositories ---

async def list_repos(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> list[CodeRepo]:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(CodeRepo)
        .where(CodeRepo.workspace_id == workspace_id)
        .order_by(CodeRepo.created_at.desc())
    )
    return list(result.scalars().all())


async def create_repo(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    data: CodeRepoCreate,
) -> CodeRepo:
    await _require_workspace_access(db, workspace_id, user.id)
    repo = CodeRepo(
        workspace_id=workspace_id,
        name=data.name.strip(),
        description=data.description.strip() if data.description else None,
        created_by=user.id,
    )
    db.add(repo)
    await db.flush()
    await db.refresh(repo)
    return repo


async def get_repo(
    db: AsyncSession,
    workspace_id: UUID,
    repo_id: UUID,
    user_id: UUID,
) -> CodeRepo:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(CodeRepo).where(CodeRepo.id == repo_id, CodeRepo.workspace_id == workspace_id)
    )
    repo = result.scalar_one_or_none()
    if not repo:
        raise AuthError("Repository not found", status_code=404)
    return repo


# --- Commits ---

async def list_commits(
    db: AsyncSession,
    workspace_id: UUID,
    repo_id: UUID,
    user_id: UUID,
) -> list[Commit]:
    await get_repo(db, workspace_id, repo_id, user_id)
    result = await db.execute(
        select(Commit).where(Commit.repo_id == repo_id).order_by(Commit.created_at.desc())
    )
    return list(result.scalars().all())


async def create_commit(
    db: AsyncSession,
    workspace_id: UUID,
    repo_id: UUID,
    user: User,
    data: CommitCreate,
) -> Commit:
    await get_repo(db, workspace_id, repo_id, user.id)
    commit_hash = data.hash or secrets.token_hex(20)
    commit = Commit(
        repo_id=repo_id,
        message=data.message.strip(),
        hash=commit_hash,
        author_id=user.id,
    )
    db.add(commit)
    await db.flush()
    await db.refresh(commit)
    return commit


# --- Issues ---

async def list_issues(
    db: AsyncSession,
    workspace_id: UUID,
    repo_id: UUID,
    user_id: UUID,
    status: IssueStatus | None = None,
) -> list[Issue]:
    await get_repo(db, workspace_id, repo_id, user_id)
    query = select(Issue).where(Issue.repo_id == repo_id)
    if status is not None:
        query = query.where(Issue.status == status)
    query = query.order_by(Issue.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_issue(
    db: AsyncSession,
    workspace_id: UUID,
    repo_id: UUID,
    user: User,
    data: IssueCreate,
) -> Issue:
    await get_repo(db, workspace_id, repo_id, user.id)
    issue = Issue(
        repo_id=repo_id,
        title=data.title.strip(),
        description=data.description.strip() if data.description else None,
        status=data.status,
        created_by=user.id,
    )
    db.add(issue)
    await db.flush()
    await db.refresh(issue)
    return issue


async def update_issue(
    db: AsyncSession,
    workspace_id: UUID,
    repo_id: UUID,
    issue_id: UUID,
    user_id: UUID,
    data: IssueUpdate,
) -> Issue:
    await get_repo(db, workspace_id, repo_id, user_id)
    result = await db.execute(
        select(Issue).where(Issue.id == issue_id, Issue.repo_id == repo_id)
    )
    issue = result.scalar_one_or_none()
    if not issue:
        raise AuthError("Issue not found", status_code=404)

    if data.title is not None:
        issue.title = data.title.strip()
    if data.description is not None:
        issue.description = data.description.strip() if data.description else None
    if data.status is not None:
        issue.status = data.status

    await db.flush()
    await db.refresh(issue)
    return issue


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
