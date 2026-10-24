"""Meetings: scheduling, access, starting, ending, and the hand-off to transcript and MoM.

Rules
- A meeting is only created by an explicit request from a signed-in workspace member, after
  validation. A repeated request with the same `client_request_id` returns the original meeting.
- Visibility: with no invitees, every workspace member can see and join; with invitees, only the
  organizer, the invitees and workspace owners/admins can.
- Only the organizer or a workspace owner/admin ("host") can edit, cancel or end for everyone.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app import database
from app.config import get_settings
from app.models import (
    CalendarEvent,
    CalendarEventPriority,
    CalendarEventSource,
    CalendarEventType,
    Meeting,
    MeetingInvitee,
    MeetingRecurrence,
    MeetingStatus,
    SessionRecord,
    SessionSource,
    SessionStatus,
    TranscriptSegment,
    User,
    WorkspaceRole,
)
from app.schemas.meeting import MeetingInstant, MeetingSchedule, MeetingUpdate
from app.services import notification_service
from app.services.auth_service import AuthError
from app.services.meeting_hub import meeting_hub
from app.services.workspace_service import get_workspace_membership

logger = logging.getLogger(__name__)

# A live meeting nobody is connected to is ended automatically after this long.
EMPTY_MEETING_TIMEOUT_SECONDS = 10 * 60
MOM_UPLOAD_WAIT_SECONDS = 20
_BACKGROUND: set[asyncio.Task] = set()


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


async def serialize(db: AsyncSession, meeting: Meeting, viewer_id: UUID | None = None) -> dict:
    invitees = (await db.execute(
        select(User.id, User.name).join(MeetingInvitee, MeetingInvitee.user_id == User.id)
        .where(MeetingInvitee.meeting_id == meeting.id)
    )).all()
    organizer = await db.get(User, meeting.organizer_id) if meeting.organizer_id else None
    data = {
        "id": str(meeting.id),
        "workspace_id": str(meeting.workspace_id),
        "title": meeting.title,
        "description": meeting.description,
        "agenda": meeting.agenda,
        "status": meeting.status.value,
        "organizer_id": str(meeting.organizer_id) if meeting.organizer_id else None,
        "organizer_name": organizer.name if organizer else None,
        "scheduled_start": _aware(meeting.scheduled_start).isoformat() if meeting.scheduled_start else None,
        "duration_minutes": meeting.duration_minutes,
        "timezone": meeting.timezone,
        "recurrence": meeting.recurrence.value,
        "recurrence_parent_id": str(meeting.recurrence_parent_id) if meeting.recurrence_parent_id else None,
        "started_at": _aware(meeting.started_at).isoformat() if meeting.started_at else None,
        "ended_at": _aware(meeting.ended_at).isoformat() if meeting.ended_at else None,
        "transcription_enabled": meeting.transcription_enabled,
        "session_id": str(meeting.session_id) if meeting.session_id else None,
        "invitees": [{"id": str(uid), "name": name} for uid, name in invitees],
        "participant_count": meeting_hub.connected_count(meeting.id),
        "created_at": _aware(meeting.created_at).isoformat() if meeting.created_at else None,
    }
    if viewer_id is not None:
        data["is_host"] = await is_host(db, meeting, viewer_id)
    return data


async def _membership(db: AsyncSession, workspace_id: UUID, user_id: UUID):
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
    return membership


async def is_host(db: AsyncSession, meeting: Meeting, user_id: UUID) -> bool:
    if meeting.organizer_id == user_id:
        return True
    membership = await get_workspace_membership(db, meeting.workspace_id, user_id)
    return bool(membership and membership.role in (WorkspaceRole.OWNER, WorkspaceRole.ADMIN))


async def _invitee_ids(db: AsyncSession, meeting_id: UUID) -> list[UUID]:
    return list((await db.execute(select(MeetingInvitee.user_id).where(MeetingInvitee.meeting_id == meeting_id))).scalars())


async def can_access(db: AsyncSession, meeting: Meeting, user_id: UUID) -> bool:
    membership = await get_workspace_membership(db, meeting.workspace_id, user_id)
    if not membership:
        return False
    if meeting.organizer_id == user_id or membership.role in (WorkspaceRole.OWNER, WorkspaceRole.ADMIN):
        return True
    invitees = await _invitee_ids(db, meeting.id)
    return not invitees or user_id in invitees


async def get_meeting(db: AsyncSession, workspace_id: UUID, meeting_id: UUID, user_id: UUID) -> Meeting:
    meeting = await db.get(Meeting, meeting_id)
    if meeting is None or meeting.workspace_id != workspace_id or not await can_access(db, meeting, user_id):
        raise AuthError("Meeting not found", status_code=404)
    return meeting


async def _validate_invitees(db: AsyncSession, workspace_id: UUID, invitee_ids: list[UUID]) -> list[UUID]:
    unique = list(dict.fromkeys(invitee_ids))
    for uid in unique:
        if not await get_workspace_membership(db, workspace_id, uid):
            raise AuthError("Invitees must be members of this workspace", status_code=400)
    return unique


def _local_parts(start_utc: datetime, tz: str) -> tuple[str, str]:
    local = start_utc.astimezone(ZoneInfo(tz))
    return local.date().isoformat(), local.strftime("%H:%M")


async def _existing_request(db: AsyncSession, organizer_id: UUID, client_request_id: str | None) -> Meeting | None:
    if not client_request_id:
        return None
    return (await db.execute(
        select(Meeting).where(Meeting.organizer_id == organizer_id, Meeting.client_request_id == client_request_id)
    )).scalar_one_or_none()


async def schedule_meeting(db: AsyncSession, workspace_id: UUID, user: User, data: MeetingSchedule) -> tuple[Meeting, bool]:
    """Returns (first meeting, created). A retried request returns the original with created=False."""
    await _membership(db, workspace_id, user.id)
    existing = await _existing_request(db, user.id, data.client_request_id)
    if existing:
        return existing, False
    invitees = await _validate_invitees(db, workspace_id, [i for i in data.invitee_ids if i != user.id])

    step = {MeetingRecurrence.DAILY: timedelta(days=1), MeetingRecurrence.WEEKLY: timedelta(weeks=1)}.get(data.recurrence)
    tz = ZoneInfo(data.timezone)
    local_first = data.scheduled_start.astimezone(tz)
    meetings: list[Meeting] = []
    for index in range(data.occurrences):
        # Step in local time so a weekly 10:00 stays 10:00 across daylight-saving changes.
        local_start = local_first + step * index if step else local_first
        start_utc = local_start.replace(tzinfo=None).replace(tzinfo=tz).astimezone(UTC)
        meeting = Meeting(
            workspace_id=workspace_id, title=data.title, description=data.description, agenda=data.agenda,
            organizer_id=user.id, status=MeetingStatus.SCHEDULED, scheduled_start=start_utc,
            duration_minutes=data.duration_minutes, timezone=data.timezone, recurrence=data.recurrence,
            recurrence_parent_id=meetings[0].id if meetings else None,
            client_request_id=data.client_request_id if index == 0 else None,
        )
        db.add(meeting)
        try:
            async with db.begin_nested():
                await db.flush()
        except IntegrityError:  # the same request is being processed concurrently
            original = await _existing_request(db, user.id, data.client_request_id)
            if original:
                return original, False
            raise
        meetings.append(meeting)
        for uid in invitees:
            db.add(MeetingInvitee(meeting_id=meeting.id, user_id=uid))
        event_date, event_time = _local_parts(start_utc, data.timezone)
        db.add(CalendarEvent(
            workspace_id=workspace_id, user_id=user.id, title=data.title,
            description=data.description or data.agenda, event_date=event_date, event_time=event_time,
            event_type=CalendarEventType.MEETING, priority=CalendarEventPriority.MEDIUM,
            source=CalendarEventSource.MANUAL, meeting_id=meeting.id,
        ))
    await db.flush()

    first = meetings[0]
    when = f"{local_first.strftime('%a %d %b, %H:%M')} ({data.timezone})"
    repeat = f", repeats {data.recurrence.value} × {data.occurrences}" if data.occurrences > 1 else ""
    await notification_service.notify_many(
        db, invitees, kind="meeting_invite", category="meetings", workspace_id=workspace_id,
        title=f"{user.name} invited you to “{data.title}”", body=f"{when}{repeat}",
        link={"tab": "meetings", "meeting_id": str(first.id)}, dedupe_key=f"meeting_invite:{first.id}",
        actor_id=user.id,
    )
    return first, True


async def start_instant(db: AsyncSession, workspace_id: UUID, user: User, data: MeetingInstant) -> tuple[Meeting, bool]:
    await _membership(db, workspace_id, user.id)
    existing = await _existing_request(db, user.id, data.client_request_id)
    if existing:
        return existing, False
    invitees = await _validate_invitees(db, workspace_id, [i for i in data.invitee_ids if i != user.id])
    now = datetime.now(UTC)
    meeting = Meeting(
        workspace_id=workspace_id, title=data.title, organizer_id=user.id, status=MeetingStatus.LIVE,
        scheduled_start=now, started_at=now, timezone="UTC", client_request_id=data.client_request_id,
    )
    db.add(meeting)
    try:
        async with db.begin_nested():
            await db.flush()
    except IntegrityError:
        original = await _existing_request(db, user.id, data.client_request_id)
        if original:
            return original, False
        raise
    for uid in invitees:
        db.add(MeetingInvitee(meeting_id=meeting.id, user_id=uid))
    await db.flush()
    recipients = invitees or await _workspace_member_ids(db, workspace_id)
    await notification_service.notify_many(
        db, recipients, kind="meeting_started", category="meetings", workspace_id=workspace_id,
        title=f"{user.name} started “{meeting.title}”", body="Join now from Meetings.",
        link={"tab": "meetings", "meeting_id": str(meeting.id), "join": True},
        dedupe_key=f"meeting_started:{meeting.id}", actor_id=user.id,
    )
    return meeting, True


async def _workspace_member_ids(db: AsyncSession, workspace_id: UUID) -> list[UUID]:
    from app.models import WorkspaceMember

    return list((await db.execute(select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id))).scalars())


async def list_meetings(db: AsyncSession, workspace_id: UUID, user_id: UUID, scope: str = "upcoming",
                        limit: int = 50) -> list[Meeting]:
    await _membership(db, workspace_id, user_id)
    query = select(Meeting).where(Meeting.workspace_id == workspace_id)
    if scope == "upcoming":
        horizon = datetime.now(UTC) - timedelta(hours=12)
        query = query.where(
            or_(Meeting.status == MeetingStatus.LIVE,
                (Meeting.status == MeetingStatus.SCHEDULED) & (Meeting.scheduled_start >= horizon))
        ).order_by(Meeting.scheduled_start.asc())
    elif scope == "past":
        query = query.where(Meeting.status.in_([MeetingStatus.ENDED, MeetingStatus.CANCELLED])).order_by(
            Meeting.updated_at.desc())
    else:
        query = query.order_by(Meeting.created_at.desc())
    rows = list((await db.execute(query.limit(limit * 3))).scalars().all())
    visible = [m for m in rows if await can_access(db, m, user_id)]
    return visible[:limit]


async def _require_host(db: AsyncSession, meeting: Meeting, user_id: UUID, action: str) -> None:
    if not await is_host(db, meeting, user_id):
        raise AuthError(f"Only the organizer or a workspace admin can {action}", status_code=403)


async def update_meeting(db: AsyncSession, workspace_id: UUID, meeting_id: UUID, user: User, data: MeetingUpdate) -> Meeting:
    meeting = await get_meeting(db, workspace_id, meeting_id, user.id)
    await _require_host(db, meeting, user.id, "edit this meeting")
    if meeting.status != MeetingStatus.SCHEDULED:
        raise AuthError("Only scheduled meetings can be edited", status_code=409)
    changes = data.model_dump(exclude_unset=True)
    for field_name in ("title", "description", "agenda", "duration_minutes", "timezone"):
        if field_name in changes and changes[field_name] is not None:
            setattr(meeting, field_name, changes[field_name])
    if changes.get("scheduled_start"):
        meeting.scheduled_start = changes["scheduled_start"]
    if data.invitee_ids is not None:
        wanted = await _validate_invitees(db, workspace_id, [i for i in data.invitee_ids if i != meeting.organizer_id])
        current = await _invitee_ids(db, meeting.id)
        for row in (await db.execute(select(MeetingInvitee).where(MeetingInvitee.meeting_id == meeting.id))).scalars():
            if row.user_id not in wanted:
                await db.delete(row)
        for uid in wanted:
            if uid not in current:
                db.add(MeetingInvitee(meeting_id=meeting.id, user_id=uid))
    meeting.updated_at = datetime.now()
    event = (await db.execute(select(CalendarEvent).where(CalendarEvent.meeting_id == meeting.id))).scalar_one_or_none()
    if event:
        event.title = meeting.title
        event.description = meeting.description or meeting.agenda
        event.event_date, event.event_time = _local_parts(_aware(meeting.scheduled_start), meeting.timezone)
    await db.flush()
    stamp = _aware(meeting.scheduled_start).isoformat()
    await notification_service.notify_many(
        db, await _invitee_ids(db, meeting.id), kind="meeting_updated", category="meetings",
        workspace_id=workspace_id, title=f"“{meeting.title}” was updated",
        body=f"Now {stamp[:16].replace('T', ' ')} UTC, {meeting.duration_minutes} min",
        link={"tab": "meetings", "meeting_id": str(meeting.id)},
        dedupe_key=f"meeting_updated:{meeting.id}:{stamp}:{meeting.title}:{meeting.duration_minutes}", actor_id=user.id,
    )
    return meeting


async def cancel_meeting(db: AsyncSession, workspace_id: UUID, meeting_id: UUID, user: User) -> Meeting:
    meeting = await get_meeting(db, workspace_id, meeting_id, user.id)
    await _require_host(db, meeting, user.id, "cancel this meeting")
    if meeting.status == MeetingStatus.CANCELLED:
        return meeting
    if meeting.status != MeetingStatus.SCHEDULED:
        raise AuthError("Only meetings that haven't started can be cancelled", status_code=409)
    meeting.status = MeetingStatus.CANCELLED
    meeting.updated_at = datetime.now()
    for event in (await db.execute(select(CalendarEvent).where(CalendarEvent.meeting_id == meeting.id))).scalars():
        await db.delete(event)
    await db.flush()
    await notification_service.notify_many(
        db, await _invitee_ids(db, meeting.id), kind="meeting_cancelled", category="meetings",
        workspace_id=workspace_id, title=f"“{meeting.title}” was cancelled",
        body=f"Cancelled by {user.name}", link={"tab": "meetings"},
        dedupe_key=f"meeting_cancelled:{meeting.id}", actor_id=user.id,
    )
    return meeting


async def prepare_join(db: AsyncSession, meeting: Meeting, user_id: UUID) -> bool:
    """Check a user may join now; a scheduled meeting goes live on first join. Returns is_host."""
    if meeting.status in (MeetingStatus.ENDED, MeetingStatus.CANCELLED):
        raise AuthError(f"This meeting has {meeting.status.value}", status_code=410)
    if meeting.status == MeetingStatus.SCHEDULED:
        meeting.status = MeetingStatus.LIVE
        meeting.started_at = datetime.now(UTC)
        await db.flush()
    return await is_host(db, meeting, user_id)


def format_transcript(segments: list[TranscriptSegment]) -> str:
    lines = []
    for s in segments:
        if s.source == "gap":
            continue
        minutes, seconds = divmod(max(0, s.offset_ms) // 1000, 60)
        lines.append(f"[{minutes:02d}:{seconds:02d}] {s.speaker_name}: {s.text.strip()}")
    return "\n".join(lines)


async def transcript_segments(db: AsyncSession, meeting_id: UUID) -> list[TranscriptSegment]:
    return list((await db.execute(
        select(TranscriptSegment).where(TranscriptSegment.meeting_id == meeting_id)
        .order_by(TranscriptSegment.offset_ms.asc(), TranscriptSegment.created_at.asc())
    )).scalars().all())


async def end_for_all(db: AsyncSession, meeting: Meeting, user: User | None, reason: str = "host") -> SessionRecord | None:
    """End the meeting for everyone (host action, or automatic when it was left empty).

    Idempotent: a second call returns the existing session. Live clients are told and
    disconnected, the transcript is frozen into a session, and the MoM draft is generated.
    """
    if user is not None and reason == "host":
        await _require_host(db, meeting, user.id, "end this meeting for everyone")
    if meeting.status == MeetingStatus.ENDED:
        return await db.get(SessionRecord, meeting.session_id) if meeting.session_id else None
    if meeting.status in (MeetingStatus.SCHEDULED, MeetingStatus.CANCELLED):
        raise AuthError("This meeting isn't running", status_code=409)

    attendance = meeting_hub.attendance(meeting.id)
    meeting.status = MeetingStatus.ENDED
    meeting.ended_at = datetime.now(UTC)
    meeting.ended_by = user.id if user else None
    segments = await transcript_segments(db, meeting.id)
    transcript = format_transcript(segments)
    creator = meeting.organizer_id or (user.id if user else None)
    if creator is None and attendance:
        creator = UUID(next(iter(attendance)))
    if creator is None:
        # Nobody to attribute it to (organizer deleted, nobody ever joined): just close it.
        await db.flush()
        await meeting_hub.end(meeting.id, "NexaMind")
        return None
    session = SessionRecord(
        workspace_id=meeting.workspace_id, title=meeting.title, source=SessionSource.LIVE,
        transcript=transcript, status=SessionStatus.SUMMARIZING, created_by=creator,
        meeting_id=meeting.id, mom_status="draft",
        mom_data={"attendees": sorted(set(attendance.values()) | {s.speaker_name for s in segments if s.source != "gap"})},
    )
    db.add(session)
    await db.flush()
    meeting.session_id = session.id
    await db.flush()
    await meeting_hub.end(meeting.id, user.name if user else "NexaMind (meeting was empty)")
    return session


def schedule_mom_generation(session_id: UUID) -> None:
    """Draft the MoM in the background (it may take a while with an AI model)."""
    from app.services.mom_service import generate_mom_for_session

    async def run() -> None:
        # Let participants' last audio chunks finish uploading first.
        await asyncio.sleep(MOM_UPLOAD_WAIT_SECONDS)
        try:
            async with database.AsyncSessionLocal() as db:
                await generate_mom_for_session(db, session_id)
                await db.commit()
        except Exception:
            logger.exception("MoM generation failed for session %s", session_id)
            async with database.AsyncSessionLocal() as db:
                session = await db.get(SessionRecord, session_id)
                if session is not None and session.status == SessionStatus.SUMMARIZING:
                    session.status = SessionStatus.FAILED
                    await db.commit()

    task = asyncio.create_task(run())
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)


async def end_abandoned_meetings(db: AsyncSession) -> int:
    """End live meetings that nobody has been connected to for EMPTY_MEETING_TIMEOUT_SECONDS."""
    live = (await db.execute(select(Meeting).where(Meeting.status == MeetingStatus.LIVE))).scalars().all()
    ended = 0
    now = datetime.now(UTC)
    for meeting in live:
        empty = meeting_hub.empty_for(meeting.id)
        if empty is None:
            continue
        if empty == float("inf"):  # not seen since this process started
            started = _aware(meeting.started_at) or now
            empty = (now - started).total_seconds()
        if empty >= EMPTY_MEETING_TIMEOUT_SECONDS:
            session = await end_for_all(db, meeting, None, reason="empty")
            ended += 1
            if session is not None and get_settings().run_background_jobs:
                await db.commit()
                schedule_mom_generation(session.id)
    return ended
