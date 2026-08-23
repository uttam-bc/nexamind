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


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: DocumentContent | None = None

    @model_validator(mode="after")
    def validate_at_least_one_field(self) -> Self:
        if self.title is None and self.content is None:
            raise ValueError("At least one of title or content must be provided")
        return self


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    title: str
    content: dict
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime


class DocumentListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    title: str
    created_by: UUID | None
    created_at: datetime
    updated_at: datetime
