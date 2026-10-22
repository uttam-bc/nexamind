from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class FileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    filename: str
    file_size: int
    mime_type: str
    uploaded_by: UUID | None = None
    document_id: UUID | None = None
    created_at: datetime


class FileUploadResponse(FileResponse):
    # Set when the upload could not be turned into a page (e.g. a scanned PDF with no text).
    page_error: str | None = None
