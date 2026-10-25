from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ChannelCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(..., min_length=1, max_length=128)
    description: str | None = Field(default=None, max_length=2000)
    is_private: bool = False


class ChannelResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    name: str
    description: str | None = None
    is_private: bool
    is_direct: bool = False
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime


class MessageCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    content: str = Field(default="", max_length=10000)
    parent_id: UUID | None = None
    # Files uploaded for this message (POST .../attachments first), and existing library
    # files/pages shared by reference.
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=10)
    shared_file_ids: list[UUID] = Field(default_factory=list, max_length=10)
    shared_document_ids: list[UUID] = Field(default_factory=list, max_length=10)
    # Set by clients so a retried send is stored once.
    client_message_id: str | None = Field(default=None, min_length=8, max_length=80)

    @model_validator(mode="after")
    def text_or_files(self):
        if not self.content and not (self.attachment_ids or self.shared_file_ids or self.shared_document_ids):
            raise ValueError("A message needs text or at least one file")
        return self


class MessageEdit(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    content: str = Field(..., min_length=1, max_length=10000)


class ReactionToggleRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

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
    edited_at: datetime | None = None
    reply_count: int = 0
    reactions: list[ReactionSummary] = Field(default_factory=list)
    attachments: list[dict] = Field(default_factory=list)
    client_message_id: str | None = None


class ChannelUnreadSummary(BaseModel):
    channel_id: UUID
    unread_count: int

