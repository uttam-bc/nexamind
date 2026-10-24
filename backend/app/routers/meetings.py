from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import Meeting, MeetingMessage, SessionRecord, User
from app.schemas.meeting import MeetingEnd, MeetingInstant, MeetingSchedule, MeetingUpdate
from app.security import check_identity_limit
from app.services import meeting_service, mom_service, notification_service, transcription_service
from app.services.auth_service import AuthError

router = APIRouter(prefix="/workspaces/{workspace_id}/meetings", tags=["meetings"])
mom_router = APIRouter(prefix="/workspaces/{workspace_id}/sessions/{session_id}/mom", tags=["meetings"])


async def _out(db, meeting, user):
    return await meeting_service.serialize(db, meeting, user.id)


@router.get("")
async def list_meetings(
    workspace_id: UUID,
    scope: str = Query("upcoming", pattern="^(upcoming|past|all)$"),
    limit: int = Query(50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[dict]:
    meetings = await meeting_service.list_meetings(db, workspace_id, current_user.id, scope, limit)
    return [await _out(db, m, current_user) for m in meetings]


@router.post("", status_code=status.HTTP_201_CREATED)
async def schedule(
    workspace_id: UUID,
    data: MeetingSchedule,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    meeting, created = await meeting_service.schedule_meeting(db, workspace_id, current_user, data)
    if not created:
        response.status_code = status.HTTP_200_OK  # a retried request: the original meeting
    return await _out(db, meeting, current_user)


@router.post("/instant", status_code=status.HTTP_201_CREATED)
async def start_instant(
    workspace_id: UUID,
    data: MeetingInstant,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    meeting, created = await meeting_service.start_instant(db, workspace_id, current_user, data)
    if not created:
        response.status_code = status.HTTP_200_OK
    return await _out(db, meeting, current_user)


@router.get("/{meeting_id}")
async def get_meeting(
    workspace_id: UUID,
    meeting_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    return await _out(db, await meeting_service.get_meeting(db, workspace_id, meeting_id, current_user.id), current_user)


@router.patch("/{meeting_id}")
async def update_meeting(
    workspace_id: UUID,
    meeting_id: UUID,
    data: MeetingUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    meeting = await meeting_service.update_meeting(db, workspace_id, meeting_id, current_user, data)
    return await _out(db, meeting, current_user)


@router.post("/{meeting_id}/cancel")
async def cancel_meeting(
    workspace_id: UUID,
    meeting_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    meeting = await meeting_service.cancel_meeting(db, workspace_id, meeting_id, current_user)
    return await _out(db, meeting, current_user)


@router.post("/{meeting_id}/end")
async def end_meeting(
    workspace_id: UUID,
    meeting_id: UUID,
    data: MeetingEnd,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    """`scope: "me"` just acknowledges a leave (the socket closing removes you); `"all"` ends it for everyone."""
    meeting = await meeting_service.get_meeting(db, workspace_id, meeting_id, current_user.id)
    if data.scope == "me":
        return {"status": "left", "meeting": await _out(db, meeting, current_user)}
    session = await meeting_service.end_for_all(db, meeting, current_user)
    if session is not None and session.mom_data is not None and session.status.value != "done":
        await db.commit()
        if get_settings().run_background_jobs:
            meeting_service.schedule_mom_generation(session.id)
        else:
            await mom_service.generate_mom_for_session(db, session.id)
    return {"status": "ended", "session_id": str(session.id) if session else None,
            "meeting": await _out(db, meeting, current_user)}


@router.get("/{meeting_id}/messages")
async def meeting_messages(
    workspace_id: UUID,
    meeting_id: UUID,
    limit: int = Query(200, ge=1, le=500),
    before: datetime | None = Query(None, description="Older page: messages created before this time"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[dict]:
    meeting = await meeting_service.get_meeting(db, workspace_id, meeting_id, current_user.id)
    query = select(MeetingMessage).where(MeetingMessage.meeting_id == meeting.id)
    if before is not None:
        query = query.where(MeetingMessage.created_at < before)
    rows = list(reversed((await db.execute(
        query.order_by(MeetingMessage.created_at.desc(), MeetingMessage.id.desc()).limit(limit))).scalars().all()))
    parents = await reply_parents(db, rows)
    return [serialize_message(m, parents.get(m.reply_to_id)) for m in rows]


async def reply_parents(db: AsyncSession, messages: list[MeetingMessage]) -> dict:
    """The messages these reply to, in one query (they may be outside the loaded page)."""
    ids = {m.reply_to_id for m in messages if m.reply_to_id}
    if not ids:
        return {}
    rows = (await db.execute(select(MeetingMessage).where(MeetingMessage.id.in_(ids)))).scalars().all()
    return {m.id: m for m in rows}


REPLY_EXCERPT_CHARS = 140


def serialize_message(m: MeetingMessage, parent: MeetingMessage | None = None) -> dict:
    out = {"id": str(m.id), "sender_id": str(m.sender_id) if m.sender_id else None, "sender_name": m.sender_name,
           "content": m.content, "client_message_id": m.client_message_id,
           "reply_to_id": str(m.reply_to_id) if m.reply_to_id else None, "reply_to": None,
           "created_at": notification_service.iso_utc(m.created_at)}
    if m.reply_to_id:
        out["reply_to"] = ({"id": str(parent.id), "sender_name": parent.sender_name, "available": True,
                            "excerpt": parent.content[:REPLY_EXCERPT_CHARS]}
                           if parent else {"id": str(m.reply_to_id), "available": False})
    return out


# --- transcript -----------------------------------------------------------------------------

@router.get("/{meeting_id}/transcript")
async def get_transcript(
    workspace_id: UUID,
    meeting_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    meeting = await meeting_service.get_meeting(db, workspace_id, meeting_id, current_user.id)
    segments = await meeting_service.transcript_segments(db, meeting.id)
    return {
        "mode": "server" if transcription_service.server_mode_available() else "browser",
        "chunk_seconds": transcription_service.CHUNK_SECONDS,
        "enabled": meeting.transcription_enabled,
        "segments": [transcription_service.serialize(s) for s in segments if s.source != "gap"],
        "gaps": sum(1 for s in segments if s.source == "gap"),
    }


async def _live_participant(db, workspace_id, meeting_id, user) -> Meeting:
    meeting = await meeting_service.get_meeting(db, workspace_id, meeting_id, user.id)
    check_identity_limit("transcript", str(user.id), 40, 60)
    return meeting


@router.post("/{meeting_id}/transcript/chunks")
async def upload_chunk(
    workspace_id: UUID,
    meeting_id: UUID,
    audio: UploadFile = File(...),
    client_segment_id: str = Form(..., min_length=8, max_length=80),
    offset_ms: int = Form(..., ge=0),
    duration_ms: int = Form(..., ge=0, le=120000),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    meeting = await _live_participant(db, workspace_id, meeting_id, current_user)
    data = await audio.read(transcription_service.MAX_CHUNK_BYTES + 1)
    segment = await transcription_service.add_audio_chunk(
        db, meeting, current_user, data, audio.filename or "chunk.webm", audio.content_type or "audio/webm",
        client_segment_id, offset_ms, duration_ms)
    return {"segment": transcription_service.serialize(segment) if segment else None}


class TextSegment(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=5000)
    client_segment_id: str = Field(min_length=8, max_length=80)
    offset_ms: int = Field(ge=0)
    duration_ms: int = Field(default=0, ge=0, le=120000)


@router.post("/{meeting_id}/transcript/segments")
async def add_text_segment(
    workspace_id: UUID,
    meeting_id: UUID,
    data: TextSegment,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    meeting = await _live_participant(db, workspace_id, meeting_id, current_user)
    segment = await transcription_service.add_text_segment(db, meeting, current_user, data.text, data.client_segment_id,
                                                         data.offset_ms, data.duration_ms)
    return {"segment": transcription_service.serialize(segment) if segment else None}


class Gap(BaseModel):
    client_segment_id: str = Field(min_length=8, max_length=80)
    offset_ms: int = Field(ge=0)
    duration_ms: int = Field(default=0, ge=0, le=120000)


@router.post("/{meeting_id}/transcript/gaps", status_code=204)
async def report_gap(
    workspace_id: UUID,
    meeting_id: UUID,
    data: Gap,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> Response:
    meeting = await meeting_service.get_meeting(db, workspace_id, meeting_id, current_user.id)
    await transcription_service.record_gap(db, meeting, current_user, data.client_segment_id, data.offset_ms, data.duration_ms)
    return Response(status_code=204)


# --- Minutes of Meeting review --------------------------------------------------------------

async def _session(db: AsyncSession, workspace_id: UUID, session_id: UUID, user: User) -> SessionRecord:
    session = await db.get(SessionRecord, session_id)
    if session is None or session.workspace_id != workspace_id:
        raise AuthError("Session not found", status_code=404)
    if session.meeting_id:
        await meeting_service.get_meeting(db, workspace_id, session.meeting_id, user.id)  # private meetings
    else:
        from app.services.workspace_service import get_workspace_membership

        if not await get_workspace_membership(db, workspace_id, user.id):
            raise AuthError("Session not found", status_code=404)
    return session


async def _mom_out(db: AsyncSession, session: SessionRecord, user: User) -> dict:
    items = await mom_service.action_items_for(db, session.id)
    ids = {i.assignee_id for i in items if i.assignee_id}
    names = {uid: name for uid, name in (await db.execute(select(User.id, User.name).where(User.id.in_(ids)))).all()} if ids else {}
    return {
        "session_id": str(session.id),
        "meeting_id": str(session.meeting_id) if session.meeting_id else None,
        "title": session.title,
        "status": session.status.value,
        "mom_status": session.mom_status,
        "markdown": session.ai_summary,
        "data": session.mom_data or {},
        "transcript": session.transcript,
        "action_items": [mom_service.serialize_action_item(i, names) for i in items],
        "can_review": await mom_service.can_review(db, session, user.id),
        "approved_at": notification_service.iso_utc(session.mom_approved_at),
    }


@mom_router.get("")
async def get_mom(workspace_id: UUID, session_id: UUID, current_user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db, scope="function")) -> dict:
    return await _mom_out(db, await _session(db, workspace_id, session_id, current_user), current_user)


@mom_router.post("/generate")
async def regenerate_mom(workspace_id: UUID, session_id: UUID, current_user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db, scope="function")) -> dict:
    session = await _session(db, workspace_id, session_id, current_user)
    if not await mom_service.can_review(db, session, current_user.id):
        raise AuthError("Only the meeting organizer or a workspace admin can regenerate the minutes", status_code=403)
    check_identity_limit("mom-generate", str(current_user.id), 6, 60)
    await mom_service.generate_mom_for_session(db, session.id)
    return await _mom_out(db, session, current_user)


class MomEdit(BaseModel):
    markdown: str = Field(min_length=1, max_length=100000)


@mom_router.patch("")
async def edit_mom(workspace_id: UUID, session_id: UUID, data: MomEdit, current_user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db, scope="function")) -> dict:
    session = await _session(db, workspace_id, session_id, current_user)
    await mom_service.edit_mom(db, session, current_user.id, data.markdown)
    return await _mom_out(db, session, current_user)


class ActionItemIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str = Field(min_length=1, max_length=500)
    assignee_id: UUID | None = None
    due_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class ActionItemPatch(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    text: str | None = Field(default=None, min_length=1, max_length=500)
    assignee_id: UUID | None = None
    due_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    rejected: bool | None = None


@mom_router.post("/action-items", status_code=201)
async def add_item(workspace_id: UUID, session_id: UUID, data: ActionItemIn, current_user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db, scope="function")) -> dict:
    session = await _session(db, workspace_id, session_id, current_user)
    await mom_service.add_action_item(db, session, current_user.id, data.text, data.assignee_id, data.due_date)
    return await _mom_out(db, session, current_user)


@mom_router.patch("/action-items/{item_id}")
async def patch_item(workspace_id: UUID, session_id: UUID, item_id: UUID, data: ActionItemPatch,
                     current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db, scope="function")) -> dict:
    session = await _session(db, workspace_id, session_id, current_user)
    await mom_service.update_action_item(db, session, item_id, current_user.id, data.model_dump(exclude_unset=True))
    return await _mom_out(db, session, current_user)


class Approve(BaseModel):
    item_ids: list[UUID] = Field(default_factory=list, max_length=100)


@mom_router.post("/approve")
async def approve(workspace_id: UUID, session_id: UUID, data: Approve, current_user: User = Depends(get_current_user),
                  db: AsyncSession = Depends(get_db, scope="function")) -> dict:
    session = await _session(db, workspace_id, session_id, current_user)
    tasks = await mom_service.approve_mom(db, session, current_user, data.item_ids)
    out = await _mom_out(db, session, current_user)
    out["created_task_ids"] = [str(t.id) for t in tasks]
    return out
