import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base


class CalendarEventType(str, enum.Enum):
    MEETING = "meeting"
    DEADLINE = "deadline"
    REMINDER = "reminder"
    MILESTONE = "milestone"
    TASK = "task"


class CalendarEventPriority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


class CalendarEventSource(str, enum.Enum):
    MANUAL = "manual"
    AI_DETECTED = "ai_detected"
    MEETING_MOM = "meeting_mom"
    DOCUMENT = "document"


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_date: Mapped[str] = mapped_column(String(32), nullable=False)  # ISO date YYYY-MM-DD
    event_time: Mapped[str | None] = mapped_column(String(32), nullable=True)  # HH:MM or AM/PM string
    event_type: Mapped[CalendarEventType] = mapped_column(
        Enum(CalendarEventType, name="calendar_event_type", native_enum=False),
        default=CalendarEventType.MEETING,
        nullable=False,
    )
    priority: Mapped[CalendarEventPriority] = mapped_column(
        Enum(CalendarEventPriority, name="calendar_event_priority", native_enum=False),
        default=CalendarEventPriority.MEDIUM,
        nullable=False,
    )
    source: Mapped[CalendarEventSource] = mapped_column(
        Enum(CalendarEventSource, name="calendar_event_source", native_enum=False),
        default=CalendarEventSource.MANUAL,
        nullable=False,
    )
    is_completed: Mapped[bool] = mapped_column(default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    workspace: Mapped["Workspace"] = relationship(back_populates="calendar_events")
    user: Mapped["User"] = relationship()
