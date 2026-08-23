import logging
import os
import uuid
from pathlib import Path
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import database
from app.models import SessionRecord, SessionSource, SessionStatus, User

from app.schemas.session import SessionCreate, SessionResponse, SessionUpdate
from app.services.ai_service import summarize_meeting_transcript, transcribe_audio
from app.services.auth_service import AuthError
from app.services.websocket_manager import ws_manager
from app.services.workspace_service import get_workspace_membership

logger = logging.getLogger(__name__)
SESSION_UPLOAD_DIR = Path("uploads/sessions")


async def list_sessions(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    status: SessionStatus | None = None,
    limit: int = 50,
) -> list[SessionRecord]:
    await _require_workspace_access(db, workspace_id, user_id)
    query = select(SessionRecord).where(SessionRecord.workspace_id == workspace_id)
    if status is not None:
        query = query.where(SessionRecord.status == status)
    query = query.order_by(SessionRecord.created_at.desc()).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_session(
    db: AsyncSession,
    workspace_id: UUID,
    session_id: UUID,
    user_id: UUID,
) -> SessionRecord:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(SessionRecord).where(
            SessionRecord.id == session_id,
            SessionRecord.workspace_id == workspace_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise AuthError("Session not found", status_code=404)
    return session


async def create_session(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    data: SessionCreate,
) -> SessionRecord:
    await _require_workspace_access(db, workspace_id, user.id)

    session = SessionRecord(
        workspace_id=workspace_id,
        title=data.title.strip(),
        source=data.source,
        transcript=data.transcript,
        ai_summary=data.ai_summary,
        action_items=data.action_items or [],
        status=SessionStatus.DONE,
        created_by=user.id,
    )
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return session


async def upload_session_file(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    file: UploadFile,
    title: str | None = None,
) -> SessionRecord:
    await _require_workspace_access(db, workspace_id, user.id)

    target_dir = SESSION_UPLOAD_DIR / str(workspace_id)
    target_dir.mkdir(parents=True, exist_ok=True)

    file_uuid = uuid.uuid4()
    original_filename = file.filename or "recording.webm"
    file_extension = Path(original_filename).suffix or ".webm"
    saved_filename = f"{file_uuid}{file_extension}"
    target_path = target_dir / saved_filename

    content = await file.read()
    file_size = len(content)

    with open(target_path, "wb") as f:
        f.write(content)

    session_title = title.strip() if title else f"Meeting Recording - {Path(original_filename).stem}"

    session = SessionRecord(
        id=file_uuid,
        workspace_id=workspace_id,
        title=session_title,
        source=SessionSource.UPLOAD,
        file_path=str(target_path),
        file_size=file_size,
        mime_type=file.content_type or "audio/webm",
        status=SessionStatus.UPLOADING,
        created_by=user.id,
    )
    db.add(session)
    await db.flush()
    await db.refresh(session)
    return session


async def update_session(
    db: AsyncSession,
    workspace_id: UUID,
    session_id: UUID,
    user_id: UUID,
    data: SessionUpdate,
) -> SessionRecord:
    session = await get_session(db, workspace_id, session_id, user_id)
    if data.title is not None:
        session.title = data.title.strip()
    if data.transcript is not None:
        session.transcript = data.transcript
    if data.ai_summary is not None:
        session.ai_summary = data.ai_summary
    if data.action_items is not None:
        session.action_items = data.action_items
    if data.status is not None:
        session.status = data.status

    await db.flush()
    await db.refresh(session)
    return session


async def delete_session(
    db: AsyncSession,
    workspace_id: UUID,
    session_id: UUID,
    user_id: UUID,
) -> None:
    session = await get_session(db, workspace_id, session_id, user_id)
    if session.file_path and os.path.exists(session.file_path):
        try:
            os.remove(session.file_path)
        except OSError:
            pass
    await db.delete(session)
    await db.flush()


async def process_session_pipeline(
    session_id: UUID,
    workspace_id: UUID,
    db: AsyncSession | None = None,
) -> None:
    """Async processing pipeline: Transcribe -> Summarize -> Store."""
    logger.info("Starting processing pipeline for session %s", session_id)

    async def _execute_with_session(operation):
        if db is not None:
            res = await operation(db)
            await db.flush()
            return res
        async with database.AsyncSessionLocal() as session:
            result = await operation(session)
            await session.commit()
            return result

    async def _fetch_info(session: AsyncSession):
        res = await session.execute(select(SessionRecord).where(SessionRecord.id == session_id))
        s = res.scalar_one_or_none()
        if not s:
            return None, None
        return s.file_path, s.title

    file_path, session_title = await _execute_with_session(_fetch_info)
    if not file_path:
        logger.error("Session %s not found for pipeline processing", session_id)
        return

    if not os.path.exists(file_path):
        async def _set_missing_file(session: AsyncSession):
            s = (await session.execute(select(SessionRecord).where(SessionRecord.id == session_id))).scalar_one_or_none()
            if s:
                s.status = SessionStatus.FAILED
                s.error_message = "Recording file missing"
                await session.flush()
                await session.refresh(s)
                return SessionResponse.model_validate(s).model_dump(mode="json")
        data = await _execute_with_session(_set_missing_file)
        if data:
            await _broadcast_session_status(workspace_id, session_id, SessionStatus.FAILED, data)
        return

    try:
        # Step 1: Transcribing
        async def _set_transcribing(session: AsyncSession):
            s = (await session.execute(select(SessionRecord).where(SessionRecord.id == session_id))).scalar_one_or_none()
            if s:
                s.status = SessionStatus.TRANSCRIBING
                await session.flush()
                await session.refresh(s)
                return SessionResponse.model_validate(s).model_dump(mode="json")

        d1 = await _execute_with_session(_set_transcribing)
        if d1:
            await _broadcast_session_status(workspace_id, session_id, SessionStatus.TRANSCRIBING, d1)

        transcript = await transcribe_audio(file_path)

        # Step 2: Summarizing
        async def _set_summarizing(session: AsyncSession):
            s = (await session.execute(select(SessionRecord).where(SessionRecord.id == session_id))).scalar_one_or_none()
            if s:
                s.transcript = transcript
                s.status = SessionStatus.SUMMARIZING
                await session.flush()
                await session.refresh(s)
                return SessionResponse.model_validate(s).model_dump(mode="json")

        d2 = await _execute_with_session(_set_summarizing)
        if d2:
            await _broadcast_session_status(workspace_id, session_id, SessionStatus.SUMMARIZING, d2)

        summary, action_items = await summarize_meeting_transcript(transcript, session_title)

        # Step 3: Done
        async def _set_done(session: AsyncSession):
            s = (await session.execute(select(SessionRecord).where(SessionRecord.id == session_id))).scalar_one_or_none()
            if s:
                s.ai_summary = summary
                s.action_items = action_items
                s.status = SessionStatus.DONE
                await session.flush()
                await session.refresh(s)
                return SessionResponse.model_validate(s).model_dump(mode="json")

        d3 = await _execute_with_session(_set_done)
        if d3:
            await _broadcast_session_status(workspace_id, session_id, SessionStatus.DONE, d3)

        logger.info("Session %s successfully processed by pipeline", session_id)

    except Exception as exc:
        logger.error("Pipeline failed for session %s: %s", session_id, exc)
        async def _set_failed(session: AsyncSession):
            s = (await session.execute(select(SessionRecord).where(SessionRecord.id == session_id))).scalar_one_or_none()
            if s:
                s.status = SessionStatus.FAILED
                s.error_message = str(exc)
                await session.flush()
                await session.refresh(s)
                return SessionResponse.model_validate(s).model_dump(mode="json")

        d_err = await _execute_with_session(_set_failed)
        if d_err:
            await _broadcast_session_status(workspace_id, session_id, SessionStatus.FAILED, d_err)


async def _broadcast_session_status(
    workspace_id: UUID,
    session_id: UUID,
    status: SessionStatus,
    session_data: dict,
) -> None:
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {
            "event": "session_status_changed",
            "workspace_id": str(workspace_id),
            "session_id": str(session_id),
            "status": status,
            "data": session_data,
        },
    )



async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
