"""Continuous meeting transcription.

Each participant's browser records its own microphone in short, self-contained audio chunks and
uploads them here; the server transcribes each chunk (Groq Whisper, falling back to Gemini) and
stores it as a timestamped segment labelled with that speaker. This keeps working for meetings of
any length: there is no long-lived recognition session to time out, a failed chunk is retried by
the client with the same `client_segment_id` (so it is never stored twice), and a chunk that
finally fails is recorded as a gap so the minutes can say they may be incomplete.

When no server-side speech provider is configured, browsers fall back to the Web Speech API and
post text segments to the same store.
"""

import base64
import logging
import os
import tempfile
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Meeting, MeetingStatus, TranscriptSegment, User
from app.services import llm_client
from app.services.auth_service import AuthError
from app.services.meeting_hub import meeting_hub

logger = logging.getLogger(__name__)

CHUNK_SECONDS = 15
MAX_CHUNK_BYTES = 8 * 1024 * 1024
# Whisper is known to "hear" these on silence; a chunk containing only one of them is dropped.
SILENCE_HALLUCINATIONS = {"thank you", "thank you.", "thanks for watching!", "thanks for watching.", "you", "bye.", "."}


def server_mode_available() -> bool:
    return bool(llm_client.groq_key() or llm_client.resolve_gemini_key())


def serialize(segment: TranscriptSegment) -> dict:
    return {
        "id": str(segment.id), "speaker_id": str(segment.speaker_id) if segment.speaker_id else None,
        "speaker_name": segment.speaker_name, "text": segment.text, "offset_ms": segment.offset_ms,
        "duration_ms": segment.duration_ms, "source": segment.source, "client_segment_id": segment.client_segment_id,
    }


# Audio recorded just before the host ended the meeting is still uploading; accept it for a while.
LATE_UPLOAD_GRACE = timedelta(seconds=90)


def _require_open(meeting: Meeting, offset_ms: int | None = None) -> None:
    if meeting.status == MeetingStatus.ENDED and offset_ms is not None and meeting.ended_at and meeting.started_at:
        ended = meeting.ended_at if meeting.ended_at.tzinfo else meeting.ended_at.replace(tzinfo=UTC)
        started = meeting.started_at if meeting.started_at.tzinfo else meeting.started_at.replace(tzinfo=UTC)
        recorded_before_end = offset_ms <= (ended - started).total_seconds() * 1000 + 2000
        if recorded_before_end and datetime.now(UTC) - ended <= LATE_UPLOAD_GRACE:
            return
    if meeting.status != MeetingStatus.LIVE:
        raise AuthError("Transcripts can only be added while the meeting is live", status_code=409)
    if not meeting.transcription_enabled:
        raise AuthError("Transcription is turned off for this meeting", status_code=409)


async def _existing(db: AsyncSession, meeting_id: UUID, client_segment_id: str) -> TranscriptSegment | None:
    return (await db.execute(select(TranscriptSegment).where(
        TranscriptSegment.meeting_id == meeting_id, TranscriptSegment.client_segment_id == client_segment_id))).scalar_one_or_none()


async def _store(db: AsyncSession, meeting: Meeting, user: User, text: str, offset_ms: int, duration_ms: int,
                 source: str, client_segment_id: str) -> TranscriptSegment:
    segment = TranscriptSegment(meeting_id=meeting.id, speaker_id=user.id, speaker_name=user.name, text=text,
                                offset_ms=max(0, offset_ms), duration_ms=max(0, duration_ms), source=source,
                                client_segment_id=client_segment_id)
    try:
        async with db.begin_nested():
            db.add(segment)
            await db.flush()
    except IntegrityError:
        return await _existing(db, meeting.id, client_segment_id)
    if source != "gap":
        await meeting_hub.broadcast(meeting.id, {"type": "transcript_segment", "segment": serialize(segment)})
    return segment


async def _transcribe_bytes(data: bytes, filename: str, mime_type: str) -> str | None:
    """Text for one chunk; '' when it contained no speech; None when no provider could do it."""
    suffix = os.path.splitext(filename)[1] or ".webm"
    handle, path = tempfile.mkstemp(suffix=suffix)
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(data)
        text = await llm_client.groq_transcribe(path, filename, mime_type)
        if text is None:
            key = llm_client.resolve_gemini_key()
            if key:
                text = await llm_client.gemini_text(
                    key, "Transcribe the speech in this audio exactly. Return only the spoken words. "
                         "If there is no speech, return an empty string.",
                    extra_parts=[{"inline_data": {"mime_type": mime_type, "data": base64.b64encode(data).decode()}}],
                    max_tokens=2048)
        return text.strip() if isinstance(text, str) else None
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


async def add_audio_chunk(db: AsyncSession, meeting: Meeting, user: User, data: bytes, filename: str, mime_type: str,
                          client_segment_id: str, offset_ms: int, duration_ms: int) -> TranscriptSegment | None:
    _require_open(meeting, offset_ms)
    existing = await _existing(db, meeting.id, client_segment_id)
    if existing:
        return existing  # a retry of a chunk we already transcribed
    if not data:
        return None
    if len(data) > MAX_CHUNK_BYTES:
        raise AuthError("Audio chunk too large", status_code=413)
    text = await _transcribe_bytes(data, filename, mime_type.split(";")[0] or "audio/webm")
    if text is None:
        raise AuthError("The transcription service is unavailable right now. The chunk will be retried.", status_code=503)
    if not text or text.lower() in SILENCE_HALLUCINATIONS:
        return None
    return await _store(db, meeting, user, text, offset_ms, duration_ms, "server", client_segment_id)


async def add_text_segment(db: AsyncSession, meeting: Meeting, user: User, text: str, client_segment_id: str,
                           offset_ms: int, duration_ms: int) -> TranscriptSegment | None:
    _require_open(meeting, offset_ms)
    clean = (text or "").strip()
    if not clean:
        return None
    existing = await _existing(db, meeting.id, client_segment_id)
    return existing or await _store(db, meeting, user, clean[:5000], offset_ms, duration_ms, "browser", client_segment_id)


async def record_gap(db: AsyncSession, meeting: Meeting, user: User, client_segment_id: str, offset_ms: int,
                     duration_ms: int) -> None:
    """A chunk that could not be transcribed after all retries (kept so the MoM can flag it)."""
    if await _existing(db, meeting.id, client_segment_id) is None:
        await _store(db, meeting, user, "", offset_ms, duration_ms, "gap", client_segment_id)
