from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.report import ReportType


class ReportGenerateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    report_type: ReportType = ReportType.SPRINT_SUMMARY
    session_ids: list[UUID] = Field(default_factory=list)
    document_ids: list[UUID] = Field(default_factory=list)
    custom_prompt: str | None = None


class ReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    title: str
    report_type: ReportType
    content: str
    summary: str | None = None
    source_session_ids: list[str] | None = None
    source_document_ids: list[str] | None = None
    created_by: UUID
    created_at: datetime
    updated_at: datetime
