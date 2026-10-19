import logging
import uuid
from datetime import date, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, SessionRecord, User, WorkspaceMember
from app.models.calendar import (
    CalendarEvent,
    CalendarEventPriority,
    CalendarEventSource,
    CalendarEventType,
)
from app.schemas.calendar import (
    CalendarEventCreate,
    CalendarEventUpdate,
    DetectedReminderItem,
)
from app.services import llm_client
from app.services.auth_service import AuthError

logger = logging.getLogger(__name__)


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> WorkspaceMember:
    """Verifies that the user is a member of the requested workspace."""
    result = await db.execute(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise AuthError(status_code=403, message="User is not a member of this workspace")
    return membership


async def list_calendar_events(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    event_type: CalendarEventType | None = None,
) -> list[CalendarEvent]:
    """Lists calendar events in the workspace."""
    await _require_workspace_access(db, workspace_id, user_id)
    query = (
        select(CalendarEvent)
        .where(CalendarEvent.workspace_id == workspace_id)
        .order_by(CalendarEvent.event_date.asc(), CalendarEvent.event_time.asc())
    )
    if event_type:
        query = query.where(CalendarEvent.event_type == event_type)
    result = await db.execute(query)
    return list(result.scalars().all())


async def create_calendar_event(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    data: CalendarEventCreate,
) -> CalendarEvent:
    """Creates a new calendar event."""
    await _require_workspace_access(db, workspace_id, user.id)
    event = CalendarEvent(
        workspace_id=workspace_id,
        user_id=user.id,
        title=data.title.strip(),
        description=data.description.strip() if data.description else None,
        event_date=data.event_date.strip(),
        event_time=data.event_time.strip() if data.event_time else None,
        event_type=data.event_type,
        priority=data.priority,
        source=data.source,
        is_completed=data.is_completed,
    )
    db.add(event)
    await db.flush()
    await db.refresh(event)
    return event


async def get_calendar_event(
    db: AsyncSession,
    workspace_id: UUID,
    event_id: UUID,
    user_id: UUID,
) -> CalendarEvent:
    """Fetches a specific calendar event."""
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(CalendarEvent).where(
            CalendarEvent.id == event_id,
            CalendarEvent.workspace_id == workspace_id,
        )
    )
    event = result.scalar_one_or_none()
    if not event:
        raise AuthError(status_code=404, message="Calendar event not found")
    return event


async def update_calendar_event(
    db: AsyncSession,
    workspace_id: UUID,
    event_id: UUID,
    user_id: UUID,
    data: CalendarEventUpdate,
) -> CalendarEvent:
    """Updates a calendar event."""
    event = await get_calendar_event(db, workspace_id, event_id, user_id)
    if data.title is not None:
        event.title = data.title.strip()
    if data.description is not None:
        event.description = data.description.strip() if data.description else None
    if data.event_date is not None:
        event.event_date = data.event_date.strip()
    if data.event_time is not None:
        event.event_time = data.event_time.strip() if data.event_time else None
    if data.event_type is not None:
        event.event_type = data.event_type
    if data.priority is not None:
        event.priority = data.priority
    if data.source is not None:
        event.source = data.source
    if data.is_completed is not None:
        event.is_completed = data.is_completed

    await db.flush()
    await db.refresh(event)
    return event


async def delete_calendar_event(
    db: AsyncSession,
    workspace_id: UUID,
    event_id: UUID,
    user_id: UUID,
) -> None:
    """Deletes a calendar event."""
    event = await get_calendar_event(db, workspace_id, event_id, user_id)
    await db.delete(event)
    await db.flush()


async def detect_ai_reminders_from_context(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> list[DetectedReminderItem]:
    """Scans recent meeting MoMs, session action items, and documents for upcoming events/deadlines."""
    await _require_workspace_access(db, workspace_id, user_id)

    # 1. Fetch recent meeting sessions and documents
    sess_res = await db.execute(
        select(SessionRecord)
        .where(SessionRecord.workspace_id == workspace_id)
        .order_by(SessionRecord.created_at.desc())
        .limit(5)
    )
    sessions = list(sess_res.scalars().all())

    doc_res = await db.execute(
        select(Document)
        .where(Document.workspace_id == workspace_id)
        .order_by(Document.updated_at.desc())
        .limit(5)
    )
    docs = list(doc_res.scalars().all())

    # 2. Existing calendar events (to avoid duplicate suggestions)
    existing_events_res = await db.execute(
        select(CalendarEvent).where(CalendarEvent.workspace_id == workspace_id)
    )
    existing_titles = {e.title.lower() for e in existing_events_res.scalars().all()}

    detected: list[DetectedReminderItem] = []

    # Combine text context
    context_chunks = []
    for s in sessions:
        text = f"Meeting '{s.title}':\nSummary/MoM: {s.ai_summary or ''}\nAction Items: {', '.join(s.action_items or [])}"
        context_chunks.append({"source": s.title, "type": "meeting_mom", "text": text[:1500]})

    for d in docs:
        blocks_text = " ".join(b.get("text", "") for b in d.content.get("blocks", [])) if isinstance(d.content, dict) else ""
        context_chunks.append({"source": d.title, "type": "document", "text": f"Document '{d.title}': {blocks_text[:1000]}"})

    if not context_chunks:
        return []

    # 3. LLM extraction when a provider is configured
    today_str = date.today().isoformat()
    combined_context = "\n---\n".join(c["text"] for c in context_chunks[:5])
    prompt = (
        f"Today is {today_str}. Find deadlines, scheduled meetings, review dates, and milestones that are "
        "explicitly mentioned in the workspace content below. Do not invent any.\n\n"
        f"{combined_context}\n\n"
        'Return JSON: {"reminders": [{"title": str, "suggested_date": "YYYY-MM-DD", '
        '"suggested_time": "HH:MM AM/PM" or null, "event_type": "meeting|deadline|reminder|milestone", '
        '"priority": "low|medium|high|urgent", "source_name": str, "source_type": "meeting_mom|document", '
        '"context_snippet": str}]}'
    )
    parsed = llm_client.parse_json(await llm_client.complete_text(prompt, json_mode=True))
    if isinstance(parsed, dict) and isinstance(parsed.get("reminders"), list):
        for it in parsed["reminders"][:6]:
            title = str(it.get("title") or "").strip()
            suggested = str(it.get("suggested_date") or "")
            if not title or title.lower() in existing_titles:
                continue
            try:
                date.fromisoformat(suggested)
                event_type = CalendarEventType(str(it.get("event_type", "meeting")).lower())
                priority = CalendarEventPriority(str(it.get("priority", "medium")).lower())
            except ValueError:
                continue
            detected.append(
                DetectedReminderItem(
                    id=f"ai-rem-{uuid.uuid4().hex[:8]}",
                    title=title[:255],
                    suggested_date=suggested,
                    suggested_time=it.get("suggested_time"),
                    event_type=event_type,
                    priority=priority,
                    source_name=str(it.get("source_name") or "Workspace"),
                    source_type=str(it.get("source_type") or "document"),
                    context_snippet=str(it.get("context_snippet") or "")[:500],
                )
            )
        if detected:
            return detected

    # 4. Deterministic Heuristic Extractor (analyzes action items and sessions)
    future_day = 1
    for s in sessions:
        if s.action_items:
            for item in s.action_items[:2]:
                if item.lower() not in existing_titles:
                    target_date = (date.today() + timedelta(days=future_day)).isoformat()
                    future_day += 1
                    detected.append(
                        DetectedReminderItem(
                            id=f"det-{uuid.uuid4().hex[:8]}",
                            title=f"Review: {item[:50]}",
                            suggested_date=target_date,
                            suggested_time="03:00 PM",
                            event_type=CalendarEventType.TASK if "implement" in item.lower() or "build" in item.lower() else CalendarEventType.MEETING,
                            priority=CalendarEventPriority.HIGH,
                            source_name=s.title,
                            source_type="meeting_mom",
                            context_snippet=f"Action item extracted from '{s.title}' MoM.",
                        )
                    )
        elif s.ai_summary and "Next Steps" in s.ai_summary and s.title.lower() not in existing_titles:
            target_date = (date.today() + timedelta(days=1)).isoformat()
            detected.append(
                DetectedReminderItem(
                    id=f"det-{uuid.uuid4().hex[:8]}",
                    title=f"Follow-up: {s.title}",
                    suggested_date=target_date,
                    suggested_time="11:00 AM",
                    event_type=CalendarEventType.MEETING,
                    priority=CalendarEventPriority.MEDIUM,
                    source_name=s.title,
                    source_type="meeting_mom",
                    context_snippet=f"Milestone follow-up from '{s.title}' Minutes of Meeting.",
                )
            )

    return detected[:3]
