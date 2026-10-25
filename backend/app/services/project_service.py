from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Task, User
from app.models.project import TaskStatus
from app.schemas.project import TaskCreate, TaskUpdate
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
    if (task.status == TaskStatus.DONE) != (previous_status == TaskStatus.DONE):
        from app.services import issue_service

        await issue_service.sync_from_task(db, task, actor)  # a linked issue closes/reopens with its task
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


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
