from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class FileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    filename: str
    file_path: str
    file_size: int
    mime_type: str
    uploaded_by: UUID | None = None
    created_at: datetime
