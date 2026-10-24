"""Minutes of Meeting from the real transcript, review/approval, and action items → tasks.

Safeguards against invented content
- The model must quote the transcript for every decision and action item; anything whose quote
  isn't found in the transcript is dropped.
- Owners are matched to registered workspace members only; an unclear owner stays unassigned and
  the item is flagged for review. Due dates are kept only when the date was actually spoken.
- Without an AI model, nothing is extracted except lines that literally say "Action item: …".
- An approved MoM is locked: regenerating or editing it is refused.
"""

import hashlib
import logging
import re
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ActionItemStatus,
    Meeting,
    MeetingActionItem,
    SessionRecord,
    SessionStatus,
    Task,
    TranscriptSegment,
    User,
    WorkspaceMember,
)
from app.models.project import TaskPriority, TaskStatus
from app.services import llm_client, notification_service
from app.services.auth_service import AuthError

logger = logging.getLogger(__name__)

MOM_PROMPT = """You write Minutes of Meeting strictly from the transcript below. Use only what was said.
Never invent participants, decisions, owners, tasks or dates. If something wasn't discussed, leave it out.

Meeting: {title}
Date: {date}
Attendees (joined the call): {attendees}
Transcript (each line is "[mm:ss] Speaker: words"):
{transcript}

Return JSON with exactly these keys:
{{
 "objectives": [str],            // stated purpose of the meeting; [] if not stated
 "agenda": [str],                // agenda items that were stated; [] if none
 "summary": str,                 // 3-8 sentence factual summary of what was actually discussed
 "discussion_points": [str],
 "decisions": [{{"text": str, "evidence": str}}],      // ONLY things explicitly agreed/decided
 "suggestions": [{{"text": str, "evidence": str}}],    // ideas raised but NOT agreed
 "action_items": [{{"text": str, "owner": str|null, "due_text": str|null, "due_date": "YYYY-MM-DD"|null,
                   "priority": "urgent"|"high"|null, "evidence": str}}],
 "open_questions": [str]
}}
"evidence" must be an exact quote (a few words or more) copied from the transcript.
"owner" is the person who agreed to do it, exactly as named in the transcript, or null if unclear.
"due_text" is the deadline exactly as spoken (e.g. "by Friday"), or null; "due_date" its date given today's date.
"priority" only if someone explicitly said it was urgent/high priority; otherwise null.
"""


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _in_transcript(evidence: str, transcript_norm: str) -> bool:
    quote = _normalize(evidence)
    if len(quote) < 8:
        return False
    if quote in transcript_norm:
        return True
    # Tolerate minor wording slips: most of a long quote's consecutive words must be present.
    words = quote.split()
    if len(words) < 6:
        return False
    window = " ".join(words[: max(6, int(len(words) * 0.7))])
    return window in transcript_norm


def dedupe_key(text: str) -> str:
    return hashlib.sha256(_normalize(text).encode()).hexdigest()[:40]


async def _members(db: AsyncSession, workspace_id: UUID) -> list[User]:
    return list((await db.execute(
        select(User).join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == workspace_id, User.deactivated_at.is_(None))
    )).scalars().all())


def match_member(owner: str | None, members: list[User]) -> User | None:
    """Exact full name, unique first name, or @username. Anything ambiguous returns None."""
    if not owner:
        return None
    wanted = _normalize(owner.lstrip("@"))
    if not wanted:
        return None
    exact = [m for m in members if _normalize(m.name) == wanted or (m.username and _normalize(m.username) == wanted)]
    if len(exact) == 1:
        return exact[0]
    if exact:
        return None
    first = [m for m in members if _normalize(m.name).split(" ")[0] == wanted]
    return first[0] if len(first) == 1 else None


def _due_date(item: dict, transcript_norm: str) -> str | None:
    due_text, due_date = item.get("due_text"), item.get("due_date")
    if not due_text or not due_date or _normalize(due_text) not in transcript_norm:
        return None
    try:
        return date.fromisoformat(str(due_date)).isoformat()
    except ValueError:
        return None


def _offline_extract(transcript: str) -> dict:
    items = []
    for line in transcript.splitlines():
        match = re.search(r"action item(?: for ([A-Za-z][\w .'-]{0,40}))?\s*[:\-]\s*(.+)", line, re.IGNORECASE)
        if match:
            items.append({"text": match.group(2).strip(), "owner": match.group(1), "evidence": match.group(0)})
    return {
        "objectives": [], "agenda": [], "discussion_points": [], "decisions": [], "suggestions": [],
        "open_questions": [], "action_items": items,
        "summary": "No AI model was available, so this draft contains the transcript and only action items "
                   "explicitly announced as “Action item: …”. Review and complete it before approving.",
    }


def render_markdown(meeting_title: str, meeting_date: str, mom: dict) -> str:
    def bullets(values, key=None):
        values = [v.get(key) if key and isinstance(v, dict) else v for v in (values or [])]
        values = [str(v).strip() for v in values if str(v or "").strip()]
        return "\n".join(f"- {v}" for v in values) if values else "_None recorded._"

    lines = [f"# Minutes of Meeting: {meeting_title}", "", f"**Date:** {meeting_date}  ",
             f"**Attendees:** {', '.join(mom.get('attendees') or []) or '_Not recorded_'}", ""]
    if mom.get("completeness", {}).get("is_partial"):
        lines += [f"> ⚠️ {mom['completeness']['note']}", ""]
    lines += ["## Objectives", bullets(mom.get("objectives")), "", "## Agenda", bullets(mom.get("agenda")), "",
              "## Summary", mom.get("summary") or "_No summary._", "", "## Decisions (confirmed)",
              bullets(mom.get("decisions"), "text"), "", "## Key discussion points", bullets(mom.get("discussion_points")),
              "", "## Suggestions (not agreed)", bullets(mom.get("suggestions"), "text"), "", "## Action items"]
    actions = mom.get("action_items") or []
    if actions:
        for a in actions:
            owner = a.get("assignee_name") or (f"{a['owner']} (unmatched — needs review)" if a.get("owner") else "Unassigned — needs review")
            due = f", due {a['due_date']}" if a.get("due_date") else ""
            lines.append(f"- {a['text']} — **{owner}**{due}")
    else:
        lines.append("_None recorded._")
    lines += ["", "## Open questions & follow-ups", bullets(mom.get("open_questions"))]
    return "\n".join(lines)


async def generate_mom_for_session(db: AsyncSession, session_id: UUID, force: bool = False) -> SessionRecord:
    session = await db.get(SessionRecord, session_id)
    if session is None:
        raise AuthError("Session not found", status_code=404)
    if session.mom_status == "approved":
        raise AuthError("This MoM is approved and locked. It can't be regenerated.", status_code=409)
    meeting = await db.get(Meeting, session.meeting_id) if session.meeting_id else None
    title = meeting.title if meeting else session.title
    meeting_date = ((meeting.started_at if meeting and meeting.started_at else session.created_at) or datetime.now(UTC))
    date_label = meeting_date.strftime("%A, %d %B %Y")

    segments = []
    gaps = 0
    if meeting:
        rows = (await db.execute(select(TranscriptSegment).where(TranscriptSegment.meeting_id == meeting.id)
                                 .order_by(TranscriptSegment.offset_ms))).scalars().all()
        segments = [s for s in rows if s.source != "gap"]
        gaps = sum(1 for s in rows if s.source == "gap")
    if meeting:
        # Rebuilt from the stored segments: includes audio that finished uploading after the end.
        from app.services.meeting_service import format_transcript

        session.transcript = format_transcript(segments)
    transcript = session.transcript or ""
    transcript_norm = _normalize(transcript)
    attendees = list((session.mom_data or {}).get("attendees") or [])

    if not transcript.strip():
        mom = {"objectives": [], "agenda": [], "discussion_points": [], "decisions": [], "suggestions": [],
               "action_items": [], "open_questions": [],
               "summary": "No speech was transcribed during this meeting, so there is nothing to summarise."}
        source = "empty"
    else:
        prompt = MOM_PROMPT.format(title=title, date=date_label, attendees=", ".join(attendees) or "unknown",
                                   transcript=transcript[:80000])
        parsed = llm_client.parse_json(await llm_client.complete_text(prompt, json_mode=True))
        if isinstance(parsed, dict) and str(parsed.get("summary", "")).strip():
            mom, source = parsed, "ai"
        else:
            mom, source = _offline_extract(transcript), "offline"

    members = await _members(db, session.workspace_id)
    decisions = [d for d in (mom.get("decisions") or []) if isinstance(d, dict) and _in_transcript(d.get("evidence", ""), transcript_norm)]
    suggestions = [d for d in (mom.get("suggestions") or []) if isinstance(d, dict) and _in_transcript(d.get("evidence", ""), transcript_norm)]
    actions = []
    for item in mom.get("action_items") or []:
        if not isinstance(item, dict) or not str(item.get("text") or "").strip():
            continue
        if not _in_transcript(item.get("evidence", ""), transcript_norm):
            continue  # not grounded in what was said
        owner = item.get("owner")
        member = match_member(owner, members)
        actions.append({
            "text": str(item["text"]).strip()[:500],
            "owner": owner,
            "assignee_id": str(member.id) if member else None,
            "assignee_name": member.name if member else None,
            "due_date": _due_date(item, transcript_norm),
            "priority": item.get("priority") if item.get("priority") in ("urgent", "high") else None,
            "evidence": str(item.get("evidence"))[:500],
        })

    notes = []
    if source == "offline":
        notes.append("No AI model was available; extraction was limited.")
    if gaps:
        notes.append(f"{gaps} part(s) of the audio could not be transcribed, so the minutes may be incomplete.")
    if meeting and meeting.started_at and meeting.ended_at and segments:
        spoken = segments[-1].offset_ms / 1000
        length = (meeting.ended_at.replace(tzinfo=UTC) if not meeting.ended_at.tzinfo else meeting.ended_at) - (
            meeting.started_at.replace(tzinfo=UTC) if not meeting.started_at.tzinfo else meeting.started_at)
        if length.total_seconds() > 300 and spoken < length.total_seconds() * 0.25:
            notes.append("The transcript covers only part of the meeting time.")
    if transcript.strip() and not notes and len(segments) < 3:
        notes.append("Very little speech was transcribed.")

    final = {
        "attendees": attendees,
        "objectives": [str(x) for x in mom.get("objectives") or []][:10],
        "agenda": [str(x) for x in mom.get("agenda") or []][:15],
        "summary": str(mom.get("summary") or "").strip(),
        "discussion_points": [str(x) for x in mom.get("discussion_points") or []][:20],
        "decisions": decisions[:20],
        "suggestions": suggestions[:20],
        "action_items": actions[:30],
        "open_questions": [str(x) for x in mom.get("open_questions") or []][:15],
        "completeness": {"is_partial": bool(notes), "note": " ".join(notes)},
        "source": source,
        "generated_at": datetime.now(UTC).isoformat(),
    }
    session.mom_data = final
    session.ai_summary = render_markdown(title, date_label, final)
    session.action_items = [a["text"] for a in actions]
    session.status = SessionStatus.DONE
    session.mom_status = "draft"

    # Upsert action items by content, so regenerating doesn't duplicate (and keeps reviewed ones).
    existing = {a.dedupe_key: a for a in (await db.execute(
        select(MeetingActionItem).where(MeetingActionItem.session_id == session.id))).scalars()}
    seen = set()
    for a in actions:
        key = dedupe_key(a["text"])
        seen.add(key)
        row = existing.get(key)
        if row is None:
            db.add(MeetingActionItem(
                session_id=session.id, meeting_id=session.meeting_id, workspace_id=session.workspace_id,
                text=a["text"], owner_text=a["owner"], assignee_id=UUID(a["assignee_id"]) if a["assignee_id"] else None,
                due_date=a["due_date"], evidence=a["evidence"], needs_review=a["assignee_id"] is None,
                status=ActionItemStatus.PROPOSED, dedupe_key=key,
            ))
        elif row.status == ActionItemStatus.PROPOSED:
            row.owner_text, row.evidence = a["owner"], a["evidence"]
            if row.assignee_id is None and a["assignee_id"]:
                row.assignee_id = UUID(a["assignee_id"])
            row.due_date = row.due_date or a["due_date"]
    for key, row in existing.items():
        if key not in seen and row.status == ActionItemStatus.PROPOSED and row.task_id is None and not row.evidence == "manual":
            await db.delete(row)  # no longer supported by the transcript
    await db.flush()

    if meeting and meeting.organizer_id:
        await notification_service.notify(
            db, meeting.organizer_id, kind="mom_ready", category="mom", workspace_id=session.workspace_id,
            title=f"Minutes ready for review: “{title}”",
            body="Review the draft, confirm action items and approve it to create tasks.",
            link={"tab": "meetings", "session_id": str(session.id)}, dedupe_key=f"mom_ready:{session.id}",
        )
    return session


def serialize_action_item(item: MeetingActionItem, names: dict[UUID, str]) -> dict:
    return {
        "id": str(item.id), "text": item.text, "owner_text": item.owner_text,
        "assignee_id": str(item.assignee_id) if item.assignee_id else None,
        "assignee_name": names.get(item.assignee_id) if item.assignee_id else None,
        "due_date": item.due_date, "evidence": item.evidence, "needs_review": item.needs_review,
        "status": item.status.value, "task_id": str(item.task_id) if item.task_id else None,
    }


async def action_items_for(db: AsyncSession, session_id: UUID) -> list[MeetingActionItem]:
    return list((await db.execute(
        select(MeetingActionItem).where(MeetingActionItem.session_id == session_id)
        .order_by(MeetingActionItem.created_at.asc())
    )).scalars().all())


async def can_review(db: AsyncSession, session: SessionRecord, user_id: UUID) -> bool:
    from app.services.meeting_service import is_host

    meeting = await db.get(Meeting, session.meeting_id) if session.meeting_id else None
    if meeting:
        return await is_host(db, meeting, user_id)
    from app.services.workspace_service import MANAGER_ROLES, get_workspace_membership

    if session.created_by == user_id:
        return True
    membership = await get_workspace_membership(db, session.workspace_id, user_id)
    return bool(membership and membership.role in MANAGER_ROLES)


async def _require_reviewer(db: AsyncSession, session: SessionRecord, user_id: UUID) -> None:
    if not await can_review(db, session, user_id):
        raise AuthError("Only the meeting organizer or a workspace admin can review the minutes", status_code=403)
    if session.mom_status == "approved":
        raise AuthError("These minutes are approved and locked", status_code=409)


async def edit_mom(db: AsyncSession, session: SessionRecord, user_id: UUID, summary_markdown: str) -> SessionRecord:
    await _require_reviewer(db, session, user_id)
    session.ai_summary = summary_markdown
    data = dict(session.mom_data or {})
    data["edited_by_reviewer"] = True
    session.mom_data = data
    await db.flush()
    return session


async def update_action_item(db: AsyncSession, session: SessionRecord, item_id: UUID, user_id: UUID, changes: dict) -> MeetingActionItem:
    await _require_reviewer(db, session, user_id)
    item = await db.get(MeetingActionItem, item_id)
    if item is None or item.session_id != session.id:
        raise AuthError("Action item not found", status_code=404)
    if item.status == ActionItemStatus.CONFIRMED:
        raise AuthError("This item already has a task; edit the task instead", status_code=409)
    if "text" in changes and changes["text"]:
        item.text = changes["text"].strip()[:500]
    if "assignee_id" in changes:
        assignee = changes["assignee_id"]
        if assignee is not None:
            from app.services.workspace_service import get_workspace_membership

            if not await get_workspace_membership(db, session.workspace_id, assignee):
                raise AuthError("Assignees must be workspace members", status_code=400)
        item.assignee_id = assignee
        item.needs_review = assignee is None
    if "due_date" in changes:
        item.due_date = changes["due_date"]
    if "rejected" in changes:
        item.status = ActionItemStatus.REJECTED if changes["rejected"] else ActionItemStatus.PROPOSED
    await db.flush()
    return item


async def add_action_item(db: AsyncSession, session: SessionRecord, user_id: UUID, text: str,
                          assignee_id: UUID | None, due_date: str | None) -> MeetingActionItem:
    await _require_reviewer(db, session, user_id)
    if assignee_id is not None:
        from app.services.workspace_service import get_workspace_membership

        if not await get_workspace_membership(db, session.workspace_id, assignee_id):
            raise AuthError("Assignees must be workspace members", status_code=400)
    key = dedupe_key(text)
    existing = (await db.execute(select(MeetingActionItem).where(
        MeetingActionItem.session_id == session.id, MeetingActionItem.dedupe_key == key))).scalar_one_or_none()
    if existing:
        return existing
    item = MeetingActionItem(session_id=session.id, meeting_id=session.meeting_id, workspace_id=session.workspace_id,
                             text=text.strip()[:500], assignee_id=assignee_id, due_date=due_date, evidence="manual",
                             needs_review=assignee_id is None, status=ActionItemStatus.PROPOSED, dedupe_key=key)
    db.add(item)
    await db.flush()
    return item


async def approve_mom(db: AsyncSession, session: SessionRecord, user: User, item_ids: list[UUID]) -> list[Task]:
    """Lock the minutes and turn the chosen action items into tasks (one task per item, ever)."""
    await _require_reviewer(db, session, user.id)
    meeting = await db.get(Meeting, session.meeting_id) if session.meeting_id else None
    items = {i.id: i for i in await action_items_for(db, session.id)}
    created: list[Task] = []
    for item_id in item_ids:
        item = items.get(item_id)
        if item is None:
            raise AuthError("Action item not found", status_code=404)
        if item.status == ActionItemStatus.REJECTED or item.task_id:
            continue
        due = datetime.fromisoformat(item.due_date).replace(tzinfo=UTC) if item.due_date else None
        priority = TaskPriority.MEDIUM
        for a in (session.mom_data or {}).get("action_items") or []:
            if dedupe_key(a.get("text", "")) == item.dedupe_key and a.get("priority") in ("urgent", "high"):
                priority = TaskPriority(a["priority"])
        description = f"From the meeting “{meeting.title if meeting else session.title}”."
        if item.evidence and item.evidence != "manual":
            description += f"\n\nSaid in the meeting: “{item.evidence}”"
        if item.assignee_id is None:
            description += "\n\n⚠️ The owner wasn't clear in the meeting — assign someone."
        task = Task(workspace_id=session.workspace_id, title=item.text[:255], description=description,
                    status=TaskStatus.TODO, priority=priority, assignee_id=item.assignee_id, due_date=due,
                    created_by=user.id, source_meeting_id=session.meeting_id, source_session_id=session.id)
        db.add(task)
        await db.flush()
        item.task_id = task.id
        item.status = ActionItemStatus.CONFIRMED
        created.append(task)
        if item.assignee_id:
            await notification_service.notify(
                db, item.assignee_id, kind="task_assigned", category="tasks", workspace_id=session.workspace_id,
                title=f"New task from “{meeting.title if meeting else session.title}”: {task.title}",
                body=f"Due {item.due_date}" if item.due_date else None,
                link={"tab": "projects", "task_id": str(task.id)}, dedupe_key=f"task_assigned:{task.id}:{item.assignee_id}",
                actor_id=None,
            )
    for item in items.values():
        if item.status == ActionItemStatus.PROPOSED and item.id not in item_ids:
            item.status = ActionItemStatus.REJECTED
    session.mom_status = "approved"
    session.mom_approved_by = user.id
    session.mom_approved_at = datetime.now(UTC)
    await db.flush()

    if meeting:
        from app.services.meeting_service import _invitee_ids

        attendee_ids = set(await _invitee_ids(db, meeting.id))
        attendee_ids |= {s.speaker_id for s in (await db.execute(select(TranscriptSegment).where(
            TranscriptSegment.meeting_id == meeting.id))).scalars() if s.speaker_id}
        await notification_service.notify_many(
            db, attendee_ids, kind="mom_approved", category="mom", workspace_id=session.workspace_id,
            title=f"Minutes approved: “{meeting.title}”", body=f"{len(created)} task(s) created",
            link={"tab": "meetings", "session_id": str(session.id)}, dedupe_key=f"mom_approved:{session.id}",
            actor_id=user.id,
        )
    return created
