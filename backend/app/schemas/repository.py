from uuid import UUID

from pydantic import BaseModel, Field


class RepoCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    visibility: str = "workspace"
    default_branch: str = Field(default="main", max_length=200)
    readme: bool = True
    gitignore: str | None = None
    license: str | None = None
    # Files uploaded beforehand (folder import) become the initial commit.
    upload_id: str | None = None
    include_flagged: list[str] = Field(default_factory=list, max_length=5000)


class RepoImport(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    url: str = Field(..., min_length=1, max_length=500)
    description: str | None = Field(default=None, max_length=2000)
    visibility: str = "workspace"


class RepoUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    visibility: str | None = None
    member_role: str | None = None
    default_branch: str | None = Field(default=None, max_length=200)


class RepoDelete(BaseModel):
    confirm_name: str


class FileChange(BaseModel):
    op: str
    path: str = Field(..., max_length=4096)
    to: str | None = Field(default=None, max_length=4096)
    content: str | None = None
    content_base64: str | None = None
    executable: bool = False


class CommitRequest(BaseModel):
    branch: str = Field(..., max_length=200)
    message: str = Field(..., min_length=1, max_length=5000)
    changes: list[FileChange] = Field(default_factory=list, max_length=1000)
    expected_head: str | None = Field(default=None, max_length=40)
    new_branch: str | None = Field(default=None, max_length=200)
    upload_id: str | None = None
    base_path: str = Field(default="", max_length=4096)
    include_flagged: list[str] = Field(default_factory=list, max_length=5000)


class BranchCreate(BaseModel):
    name: str = Field(..., max_length=200)
    source: str | None = Field(default=None, max_length=200)


class TagCreate(BaseModel):
    name: str = Field(..., max_length=200)
    target: str | None = Field(default=None, max_length=200)
    message: str | None = Field(default=None, max_length=20000)


class CollaboratorSet(BaseModel):
    user_id: UUID
    role: str


class BranchRuleSet(BaseModel):
    branch: str = Field(..., max_length=200)
    required_approvals: int = Field(default=1, ge=0, le=10)


class TokenCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    expires_in_days: int | None = Field(default=90, ge=1, le=366)


class IssueCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    body: str | None = Field(default=None, max_length=50000)
    labels: list[str] = Field(default_factory=list, max_length=10)
    assignee_id: UUID | None = None
    priority: str = "medium"
    milestone: str | None = Field(default=None, max_length=120)


class IssueUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    body: str | None = Field(default=None, max_length=50000)
    labels: list[str] | None = Field(default=None, max_length=10)
    assignee_id: UUID | None = None
    priority: str | None = None
    milestone: str | None = Field(default=None, max_length=120)
    state: str | None = None


class CommentCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=20000)
    path: str | None = Field(default=None, max_length=1024)
    line: int | None = None
    side: str | None = None


class TaskLink(BaseModel):
    task_id: UUID | None = None


class ActionItemIssue(BaseModel):
    action_item_id: UUID


class PullRequestCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    body: str | None = Field(default=None, max_length=50000)
    source_branch: str = Field(..., max_length=200)
    target_branch: str | None = Field(default=None, max_length=200)
    draft: bool = False
    reviewer_ids: list[UUID] = Field(default_factory=list, max_length=15)


class PullRequestUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    body: str | None = Field(default=None, max_length=50000)
    draft: bool | None = None
    reviewer_ids: list[UUID] | None = Field(default=None, max_length=15)
    state: str | None = None


class ReviewComment(BaseModel):
    body: str = Field(..., min_length=1, max_length=20000)
    path: str = Field(..., max_length=1024)
    line: int
    side: str | None = None


class ReviewCreate(BaseModel):
    state: str
    body: str | None = Field(default=None, max_length=20000)
    comments: list[ReviewComment] = Field(default_factory=list, max_length=100)


class MergeRequest(BaseModel):
    method: str = "merge"
    message: str | None = Field(default=None, max_length=10000)
    delete_branch: bool = False
    expected_head: str | None = Field(default=None, max_length=40)
