"""Periodic work: meeting reminders, task deadline notices, ending abandoned meetings, and
removing chat uploads that were never sent.

Runs once a minute when RUN_BACKGROUND_JOBS is on. Each step is safe to repeat: notifications
are de-duplicated by key, so a restart or an overlapping run never notifies twice.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app import database
from app.models import Meeting, MeetingInvitee, MeetingStatus, Task
from app.models.project import TaskStatus
from app.services import attachment_service, meeting_service, notification_service, repo_service

logger = logging.getLogger(__name__)

REMINDER_LEAD = timedelta(minutes=15)
TASK_DUE_SOON = timedelta(hours=24)
_task: asyncio.Task | None = None


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def send_meeting_reminders(db, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    due = (await db.execute(select(Meeting).where(
        Meeting.status == MeetingStatus.SCHEDULED,
        Meeting.scheduled_start > now,
        Meeting.scheduled_start <= now + REMINDER_LEAD,
    ))).scalars().all()
    sent = 0
    for meeting in due:
        invitees = list((await db.execute(select(MeetingInvitee.user_id).where(MeetingInvitee.meeting_id == meeting.id))).scalars())
        minutes = max(1, int((_aware(meeting.scheduled_start) - now).total_seconds() // 60))
        sent += await notification_service.notify_many(
            db, [meeting.organizer_id, *invitees], kind="meeting_reminder", category="meetings",
            workspace_id=meeting.workspace_id, title=f"“{meeting.title}” starts in {minutes} min",
            link={"tab": "meetings", "meeting_id": str(meeting.id), "join": True},
            dedupe_key=f"meeting_reminder:{meeting.id}:{_aware(meeting.scheduled_start).isoformat()}",
        )
    return sent


async def send_task_deadline_notices(db, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    tasks = (await db.execute(select(Task).where(
        Task.due_date.is_not(None), Task.assignee_id.is_not(None), Task.status != TaskStatus.DONE,
        Task.due_date <= now + TASK_DUE_SOON,
    ))).scalars().all()
    sent = 0
    for task in tasks:
        due = _aware(task.due_date)
        overdue = due < now
        key = f"task_{'overdue' if overdue else 'due_soon'}:{task.id}:{due.date().isoformat()}"
        created = await notification_service.notify(
            db, task.assignee_id, kind="task_overdue" if overdue else "task_due_soon", category="tasks",
            workspace_id=task.workspace_id,
            title=f"{'Overdue' if overdue else 'Due soon'}: {task.title}",
            body=f"Due {due.date().isoformat()}", link={"tab": "projects", "task_id": str(task.id)}, dedupe_key=key,
        )
        sent += 1 if created else 0
    return sent


async def run_once() -> None:
    async with database.AsyncSessionLocal() as db:
        await send_meeting_reminders(db)
        await send_task_deadline_notices(db)
        await db.commit()
    async with database.AsyncSessionLocal() as db:
        await meeting_service.end_abandoned_meetings(db)
        await db.commit()
    async with database.AsyncSessionLocal() as db:
        await attachment_service.cleanup_unsent_uploads(db)
        await db.commit()
    await asyncio.to_thread(repo_service.cleanup_storage)  # deleted repositories and abandoned uploads


async def _loop() -> None:
    while True:
        try:
            await run_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Background job run failed")
        await asyncio.sleep(60)


def start() -> None:
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())


async def stop() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
        _task = None
