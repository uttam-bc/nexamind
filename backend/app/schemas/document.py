from datetime import datetime
from typing import Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DocumentBlock(BaseModel):
    """A single block in the block-style document editor."""

    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=64)
    type: str = Field(min_length=1, max_length=64)
    text: str | None = None
    items: list[str] | None = None
    level: int | None = Field(default=None, ge=1, le=6)
    language: str | None = None
    checked: bool | None = None
    callout_icon: str | None = None
    caption: str | None = None
    url: str | None = None


class DocumentContent(BaseModel):
    model_config = ConfigDict(extra="allow")

    blocks: list[DocumentBlock] = Field(default_factory=list)
    text: str | None = None

    @model_validator(mode="after")
    def populate_blocks_from_text(self) -> Self:
        if self.text and not self.blocks:
            self.blocks = [
                DocumentBlock(
                    id="1",
                    type="paragraph",
                    text=self.text,
                )
            ]
        return self


class DocumentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: DocumentContent | None = None
    parent_id: UUID | None = None
    icon: str | None = Field(default="📄", max_length=32)


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: DocumentContent | None = None
    parent_id: UUID | None = None
    icon: str | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def validate_at_least_one_field(self) -> Self:
        if self.title is None and self.content is None and self.parent_id is None and self.icon is None:
            raise ValueError("At least one field must be provided to update")
        return self


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    parent_id: UUID | None = None
    icon: str | None = "📄"
    title: str
    content: dict
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime


class DocumentListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    parent_id: UUID | None = None
    icon: str | None = "📄"
    title: str
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime


class DocumentSearchResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    title: str
    icon: str | None = "📄"
    snippet: str
    match_type: str
    updated_at: datetime


class DocumentTreeNode(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    parent_id: UUID | None = None
    title: str
    icon: str | None = "📄"
    children: list["DocumentTreeNode"] = Field(default_factory=list)

