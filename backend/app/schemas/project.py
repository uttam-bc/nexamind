from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.project import IssueStatus, TaskPriority, TaskStatus


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    status: TaskStatus = TaskStatus.TODO
    position: float = 0.0
    priority: TaskPriority = TaskPriority.MEDIUM
    assignee_id: UUID | None = None
    due_date: datetime | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    status: TaskStatus | None = None
    position: float | None = None
    priority: TaskPriority | None = None
    assignee_id: UUID | None = None
    due_date: datetime | None = None


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    title: str
    description: str | None = None
    status: TaskStatus
    position: float
    priority: TaskPriority
    assignee_id: UUID | None = None
    due_date: datetime | None = None
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime


class CodeRepoCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None


class CodeRepoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    workspace_id: UUID
    name: str
    description: str | None = None
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime


class CommitCreate(BaseModel):
    message: str = Field(..., min_length=1)
    hash: str | None = None


class CommitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    repo_id: UUID
    message: str
    hash: str
    author_id: UUID | None = None
    created_at: datetime


class IssueCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    status: IssueStatus = IssueStatus.OPEN


class IssueUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    status: IssueStatus | None = None


class IssueResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    repo_id: UUID
    title: str
    description: str | None = None
    status: IssueStatus
    created_by: UUID | None = None
    created_at: datetime
    updated_at: datetime
