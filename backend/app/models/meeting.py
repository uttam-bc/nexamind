"""Meetings: scheduled or instant video meetings, their transcript, chat, MoM action items."""

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON, Uuid

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(UTC)


class MeetingStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    LIVE = "live"
    ENDED = "ended"
    CANCELLED = "cancelled"


class MeetingRecurrence(str, enum.Enum):
    NONE = "none"
    DAILY = "daily"
    WEEKLY = "weekly"


def _enum(cls):
    return Enum(cls, values_callable=lambda e: [m.value for m in e], native_enum=False, length=32)


class Meeting(Base):
    __tablename__ = "meetings"
    __table_args__ = (
        # A retried "create" with the same client request id returns the first meeting instead of a copy.
        UniqueConstraint("organizer_id", "client_request_id", name="uq_meetings_organizer_request"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    agenda: Mapped[str | None] = mapped_column(Text, nullable=True)
    organizer_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[MeetingStatus] = mapped_column(_enum(MeetingStatus), default=MeetingStatus.SCHEDULED, nullable=False)
    # Always stored in UTC; `timezone` is the organizer's IANA zone, used for display and recurrence.
    scheduled_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    recurrence: Mapped[MeetingRecurrence] = mapped_column(_enum(MeetingRecurrence), default=MeetingRecurrence.NONE, nullable=False)
    recurrence_parent_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("meetings.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Set for a call started from a direct message: its participants are the conversation's members,
    # whether or not they belong to `workspace_id`.
    channel_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("channels.id", ondelete="SET NULL"), nullable=True, index=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    transcription_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # The session row that holds the final transcript and Minutes of Meeting.
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True
    )
    client_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.current_timestamp(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.current_timestamp(),
        onupdate=_utcnow, nullable=False
    )


class MeetingInvitee(Base):
    __tablename__ = "meeting_invitees"
    __table_args__ = (UniqueConstraint("meeting_id", "user_id", name="uq_meeting_invitees_meeting_user"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.current_timestamp(), nullable=False
    )


class TranscriptSegment(Base):
    __tablename__ = "meeting_transcript_segments"
    __table_args__ = (
        # A chunk retried after a timeout must not produce a second copy of the same words.
        UniqueConstraint("meeting_id", "client_segment_id", name="uq_transcript_segment_client_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    speaker_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    speaker_name: Mapped[str] = mapped_column(String(255), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Milliseconds since the meeting started (for ordering and timestamps in the transcript).
    offset_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0, index=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="server")  # server | browser
    client_segment_id: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.current_timestamp(), nullable=False
    )


class MeetingMessage(Base):
    __tablename__ = "meeting_messages"
    __table_args__ = (UniqueConstraint("meeting_id", "client_message_id", name="uq_meeting_messages_client_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    meeting_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    sender_name: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    client_message_id: Mapped[str] = mapped_column(String(80), nullable=False)
    # The message this one replies to (same meeting). Kept as a real reference, not quoted text.
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("meeting_messages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.current_timestamp(), nullable=False, index=True
    )


class ActionItemStatus(str, enum.Enum):
    PROPOSED = "proposed"    # extracted from the transcript, waiting for review
    CONFIRMED = "confirmed"  # approved; a task exists
    REJECTED = "rejected"    # dismissed during review


class MeetingActionItem(Base):
    __tablename__ = "meeting_action_items"
    __table_args__ = (UniqueConstraint("session_id", "dedupe_key", name="uq_action_items_session_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    meeting_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("meetings.id", ondelete="SET NULL"), nullable=True, index=True
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    owner_text: Mapped[str | None] = mapped_column(String(255), nullable=True)  # name as spoken
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    due_date: Mapped[str | None] = mapped_column(String(10), nullable=True)  # YYYY-MM-DD, only if agreed
    evidence: Mapped[str | None] = mapped_column(Text, nullable=True)  # transcript quote it came from
    needs_review: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[ActionItemStatus] = mapped_column(_enum(ActionItemStatus), default=ActionItemStatus.PROPOSED, nullable=False)
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    dedupe_key: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.current_timestamp(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.current_timestamp(),
        onupdate=_utcnow, nullable=False
    )


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        # The same event never notifies the same person twice (reminders, retries, regeneration).
        UniqueConstraint("user_id", "dedupe_key", name="uq_notifications_user_key"),
        # The bell lists a user's newest notifications: one index serves the filter and the order.
        Index("ix_notifications_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(40), nullable=False)  # e.g. meeting_invite, task_assigned
    category: Mapped[str] = mapped_column(String(20), nullable=False)  # meetings | tasks | messages | mom
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Where clicking it goes: {"tab": "projects", "task_id": "..."} etc.
    link: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    dedupe_key: Mapped[str] = mapped_column(String(160), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Dismissed (deleted) by the user: hidden everywhere, but the row stays so dedupe_key keeps
    # the same event from notifying again.
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, server_default=func.current_timestamp(), nullable=False, index=True
    )
