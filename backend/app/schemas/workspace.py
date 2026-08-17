from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models import WorkspaceRole, WorkspaceType


class WorkspaceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class WorkspaceJoin(BaseModel):
    join_code: str = Field(min_length=6, max_length=32)


class WorkspaceMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    role: WorkspaceRole
    created_at: datetime


class WorkspaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: WorkspaceType
    owner_id: UUID
    join_code: str | None
    created_at: datetime
    updated_at: datetime


class WorkspaceDetailResponse(WorkspaceResponse):
    members: list[WorkspaceMemberResponse] = []
