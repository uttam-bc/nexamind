from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ChannelCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str | None = None
    is_private: bool = False


class ChannelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    name: str
    description: str | None = None
    is_private: bool
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime


class MessageCreate(BaseModel):
    content: str = Field(..., min_length=1)


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    channel_id: UUID
    sender_id: UUID | None = None
    content: str
    created_at: datetime
