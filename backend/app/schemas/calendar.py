from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.calendar import (
    CalendarEventPriority,
    CalendarEventSource,
    CalendarEventType,
)


class CalendarEventBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    event_date: str = Field(..., description="Date string YYYY-MM-DD")
    event_time: str | None = Field(None, description="Time string HH:MM or AM/PM")
    event_type: CalendarEventType = CalendarEventType.MEETING
    priority: CalendarEventPriority = CalendarEventPriority.MEDIUM
    source: CalendarEventSource = CalendarEventSource.MANUAL
    is_completed: bool = False


class CalendarEventCreate(CalendarEventBase):
    pass


class CalendarEventUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    event_date: str | None = None
    event_time: str | None = None
    event_type: CalendarEventType | None = None
    priority: CalendarEventPriority | None = None
    source: CalendarEventSource | None = None
    is_completed: bool | None = None


class CalendarEventResponse(CalendarEventBase):
    id: UUID
    workspace_id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DetectedReminderItem(BaseModel):
    id: str
    title: str
    suggested_date: str
    suggested_time: str | None = None
    event_type: CalendarEventType = CalendarEventType.MEETING
    priority: CalendarEventPriority = CalendarEventPriority.MEDIUM
    source_name: str
    source_type: str  # "meeting_mom" | "document"
    context_snippet: str


class DetectedRemindersResponse(BaseModel):
    reminders: list[DetectedReminderItem]
    count: int
