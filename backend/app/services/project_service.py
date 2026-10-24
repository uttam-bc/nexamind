import secrets
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CodeRepo, Commit, Issue, RepoFile, Task, User
from app.models.project import IssueStatus, TaskStatus
from app.schemas.project import (
    CodeRepoCreate,
    CommitCreate,
    IssueCreate,
    IssueUpdate,
    RepoFileCreate,
    RepoFileUpdate,
    TaskCreate,
    TaskUpdate,
)
from app.services.auth_service import AuthError
from app.services.workspace_service import get_workspace_membership, require_author_or_manager


async def list_tasks(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    status: TaskStatus | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> list[Task]:
    await _require_workspace_access(db, workspace_id, user_id)
    query = select(Task).where(Task.workspace_id == workspace_id)
    if status is not None:
        query = query.where(Task.status == status)
    query = query.order_by(Task.position.asc(), Task.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_task(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    data: TaskCreate,
) -> Task:
    await _require_workspace_access(db, workspace_id, user.id)
    if data.assignee_id and not await get_workspace_membership(db, workspace_id, data.assignee_id):
        raise AuthError("Tasks can only be assigned to workspace members", status_code=400)
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
    await _notify_assignee(db, task, actor_id=user.id, actor_name=user.name)
    return task


async def _notify_assignee(db: AsyncSession, task: Task, actor_id: UUID, actor_name: str | None = None) -> None:
    from app.services import notification_service

    if task.assignee_id:
        await notification_service.notify(
            db, task.assignee_id, kind="task_assigned", category="tasks", workspace_id=task.workspace_id,
            title=f"{actor_name or 'Someone'} assigned you: {task.title}",
            body=f"Due {task.due_date.date().isoformat()}" if task.due_date else None,
            link={"tab": "projects", "task_id": str(task.id)},
            dedupe_key=f"task_assigned:{task.id}:{task.assignee_id}", actor_id=actor_id,
        )


async def _notify_completed(db: AsyncSession, task: Task, actor_id: UUID, actor_name: str) -> None:
    from app.models import Meeting
    from app.services import notification_service

    recipients = [task.created_by]
    if task.source_meeting_id:
        meeting = await db.get(Meeting, task.source_meeting_id)
        if meeting:
            recipients.append(meeting.organizer_id)
    await notification_service.notify_many(
        db, recipients, kind="task_completed", category="tasks", workspace_id=task.workspace_id,
        title=f"{actor_name} completed: {task.title}", link={"tab": "projects", "task_id": str(task.id)},
        dedupe_key=f"task_completed:{task.id}", actor_id=actor_id,
    )


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
    previous_assignee, previous_status = task.assignee_id, task.status
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
        if not await get_workspace_membership(db, workspace_id, data.assignee_id):
            raise AuthError("Tasks can only be assigned to workspace members", status_code=400)
        task.assignee_id = data.assignee_id
    if data.due_date is not None:
        task.due_date = data.due_date

    await db.flush()
    await db.refresh(task)
    actor = await db.get(User, user_id)
    if task.assignee_id and task.assignee_id != previous_assignee:
        await _notify_assignee(db, task, actor_id=user_id, actor_name=actor.name if actor else None)
    if task.status == TaskStatus.DONE and previous_status != TaskStatus.DONE:
        await _notify_completed(db, task, actor_id=user_id, actor_name=actor.name if actor else "Someone")
    return task


async def delete_task(
    db: AsyncSession,
    workspace_id: UUID,
    task_id: UUID,
    user_id: UUID,
) -> None:
    task = await get_task(db, workspace_id, task_id, user_id)
    await require_author_or_manager(db, task.workspace_id, user_id, task.created_by)
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


# --- Code Repository Files ---

async def list_repo_files(
    db: AsyncSession,
    workspace_id: UUID,
    repo_id: UUID,
    user_id: UUID,
) -> list[RepoFile]:
    await get_repo(db, workspace_id, repo_id, user_id)
    result = await db.execute(
        select(RepoFile)
        .where(RepoFile.repo_id == repo_id)
        .order_by(RepoFile.name.asc())
    )
    return list(result.scalars().all())


async def save_repo_file(
    db: AsyncSession,
    workspace_id: UUID,
    repo_id: UUID,
    user: User,
    data: RepoFileCreate,
) -> RepoFile:
    await get_repo(db, workspace_id, repo_id, user.id)
    clean_name = data.name.strip()
    result = await db.execute(
        select(RepoFile).where(RepoFile.repo_id == repo_id, RepoFile.name == clean_name)
    )
    existing = result.scalar_one_or_none()
    if existing:
        existing.content = data.content
        if data.language:
            existing.language = data.language
        await db.flush()
        await db.refresh(existing)
        return existing

    file_record = RepoFile(
        repo_id=repo_id,
        name=clean_name,
        content=data.content,
        language=data.language or ("python" if clean_name.endswith(".py") else "javascript"),
    )
    db.add(file_record)
    await db.flush()
    await db.refresh(file_record)
    return file_record


async def delete_repo_file(
    db: AsyncSession,
    workspace_id: UUID,
    repo_id: UUID,
    file_id: UUID,
    user_id: UUID,
) -> None:
    repo = await get_repo(db, workspace_id, repo_id, user_id)
    await require_author_or_manager(db, repo.workspace_id, user_id, repo.created_by)
    result = await db.execute(
        select(RepoFile).where(RepoFile.repo_id == repo_id, RepoFile.id == file_id)
    )
    file_record = result.scalar_one_or_none()
    if file_record:
        await db.delete(file_record)
        await db.flush()


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
