import re
from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.calendar import (
    CalendarEventPriority,
    CalendarEventSource,
    CalendarEventType,
)


_TIME_24H = re.compile(r"^([01]?\d|2[0-3]):[0-5]\d$")
_TIME_12H = re.compile(r"^(0?[1-9]|1[0-2]):[0-5]\d ?([AaPp][Mm])$")


def _check_date(value: str | None) -> str | None:
    if value is None:
        return value
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ValueError("event_date must be a real date in YYYY-MM-DD format") from exc


def _check_time(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    if _TIME_24H.match(value) or _TIME_12H.match(value):
        return value
    raise ValueError("event_time must look like 14:30 or 2:30 PM")


class CalendarEventBase(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    event_date: str = Field(..., description="Date string YYYY-MM-DD")
    event_time: str | None = Field(None, description="Time string HH:MM or AM/PM")
    event_type: CalendarEventType = CalendarEventType.MEETING
    priority: CalendarEventPriority = CalendarEventPriority.MEDIUM
    source: CalendarEventSource = CalendarEventSource.MANUAL
    is_completed: bool = False


class CalendarEventCreate(CalendarEventBase):
    # Validated on input only, so older rows with free-form dates still list without errors.
    _date = field_validator("event_date")(classmethod(lambda cls, v: _check_date(v)))
    _time = field_validator("event_time")(classmethod(lambda cls, v: _check_time(v)))


class CalendarEventUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    event_date: str | None = None
    event_time: str | None = None
    event_type: CalendarEventType | None = None
    priority: CalendarEventPriority | None = None
    source: CalendarEventSource | None = None
    is_completed: bool | None = None

    _date = field_validator("event_date")(classmethod(lambda cls, v: _check_date(v)))
    _time = field_validator("event_time")(classmethod(lambda cls, v: _check_time(v)))


class CalendarEventResponse(CalendarEventBase):
    id: UUID
    workspace_id: UUID
    user_id: UUID
    meeting_id: UUID | None = None  # set when this entry is a scheduled meeting
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
