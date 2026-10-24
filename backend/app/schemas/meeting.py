from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import MeetingRecurrence

# A meeting may start a little in the past (the form was open for a while), not more.
PAST_GRACE = timedelta(minutes=5)
MAX_AHEAD = timedelta(days=730)


def _check_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("timezone must be an IANA zone such as 'Asia/Kolkata' or 'UTC'") from exc
    return value


def _check_start(value: datetime | None) -> datetime | None:
    if value is None:
        return value
    if value.tzinfo is None:
        raise ValueError("scheduled_start must include a timezone offset (for example 2026-10-30T15:00:00+05:30)")
    now = datetime.now(UTC)
    if value < now - PAST_GRACE:
        raise ValueError("scheduled_start is in the past")
    if value > now + MAX_AHEAD:
        raise ValueError("scheduled_start is more than two years away")
    return value.astimezone(UTC)


class MeetingSchedule(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    agenda: str | None = Field(default=None, max_length=5000)
    scheduled_start: datetime
    duration_minutes: int = Field(default=30, ge=5, le=24 * 60)
    timezone: str = Field(default="UTC", max_length=64)
    recurrence: MeetingRecurrence = MeetingRecurrence.NONE
    occurrences: int = Field(default=1, ge=1, le=52)
    invitee_ids: list[UUID] = Field(default_factory=list, max_length=200)
    # Sent by the client once per "Schedule" click so retries don't create duplicates.
    client_request_id: str = Field(min_length=8, max_length=64)  # a retried click returns the same meeting

    _tz = field_validator("timezone")(classmethod(lambda cls, v: _check_timezone(v)))
    _start = field_validator("scheduled_start")(classmethod(lambda cls, v: _check_start(v)))

    @model_validator(mode="after")
    def recurrence_needs_occurrences(self):
        if self.recurrence == MeetingRecurrence.NONE:
            self.occurrences = 1
        return self


class MeetingInstant(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(default="Instant meeting", min_length=1, max_length=255)
    invitee_ids: list[UUID] = Field(default_factory=list, max_length=200)
    client_request_id: str | None = Field(default=None, min_length=8, max_length=64)


class MeetingUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    agenda: str | None = Field(default=None, max_length=5000)
    scheduled_start: datetime | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=24 * 60)
    timezone: str | None = Field(default=None, max_length=64)
    invitee_ids: list[UUID] | None = Field(default=None, max_length=200)

    @field_validator("timezone")
    @classmethod
    def tz_valid(cls, v):
        return _check_timezone(v) if v is not None else v

    _start = field_validator("scheduled_start")(classmethod(lambda cls, v: _check_start(v)))


class MeetingEnd(BaseModel):
    scope: str = Field(pattern="^(me|all)$")
