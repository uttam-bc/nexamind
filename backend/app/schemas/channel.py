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
    parent_id: UUID | None = None


class ReactionToggleRequest(BaseModel):
    emoji: str = Field(..., min_length=1, max_length=32)


class ReactionSummary(BaseModel):
    emoji: str
    count: int
    user_ids: list[UUID] = Field(default_factory=list)
    has_reacted: bool = False


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    channel_id: UUID
    sender_id: UUID | None = None
    sender_name: str | None = None
    sender_username: str | None = None
    parent_id: UUID | None = None
    content: str
    created_at: datetime
    reply_count: int = 0
    reactions: list[ReactionSummary] = Field(default_factory=list)


class ChannelUnreadSummary(BaseModel):
    channel_id: UUID
    unread_count: int

