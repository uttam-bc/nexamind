from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator, Field

from app.models.session import SessionSource, SessionStatus


class SessionCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(..., min_length=1, max_length=255)
    source: SessionSource = SessionSource.NOTES
    transcript: str | None = None
    ai_summary: str | None = None
    action_items: list[str] | None = None


class SessionUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str | None = Field(None, min_length=1, max_length=255)
    transcript: str | None = None
    ai_summary: str | None = None
    action_items: list[str] | None = None
    status: SessionStatus | None = None


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def _recording_flag(cls, data):
        # Server file paths stay private; clients only learn whether a recording exists.
        if not isinstance(data, dict):
            data = {k: getattr(data, k) for k in cls.model_fields if hasattr(data, k)} | {"file_path": getattr(data, "file_path", None)}
        data = dict(data)
        data["has_recording"] = bool(data.pop("file_path", None))
        return data

    id: UUID
    workspace_id: UUID
    title: str
    source: SessionSource
    has_recording: bool = False
    file_size: int | None = None
    mime_type: str | None = None
    transcript: str | None = None
    ai_summary: str | None = None
    action_items: list[str] | None = None
    status: SessionStatus
    error_message: str | None = None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
