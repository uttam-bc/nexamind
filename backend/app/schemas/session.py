from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.session import SessionSource, SessionStatus


class SessionCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    source: SessionSource = SessionSource.NOTES
    transcript: str | None = None
    ai_summary: str | None = None
    action_items: list[str] | None = None


class SessionUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    transcript: str | None = None
    ai_summary: str | None = None
    action_items: list[str] | None = None
    status: SessionStatus | None = None


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    title: str
    source: SessionSource
    file_path: str | None = None
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
