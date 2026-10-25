"""Collaboration around Git repositories: roles, push tokens, pull requests, reviews, comments,
branch rules and the activity log. Commits, branches and tags themselves live in Git."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import JSON, Uuid

from app.database import Base

REPO_ROLES = ("read", "reviewer", "write", "maintainer", "admin", "owner")


def _now_column(onupdate: bool = False):
    kwargs = {"onupdate": datetime.now} if onupdate else {}
    return mapped_column(DateTime(timezone=True), default=datetime.now, server_default=func.current_timestamp(),
                         nullable=False, **kwargs)


def _fk(target: str, ondelete: str = "CASCADE", nullable: bool = False, index: bool = True):
    return mapped_column(Uuid(as_uuid=True), ForeignKey(target, ondelete=ondelete), nullable=nullable, index=index)


class RepoCollaborator(Base):
    __tablename__ = "repo_collaborators"
    __table_args__ = (UniqueConstraint("repo_id", "user_id", name="uq_repo_collaborators_repo_user"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    repo_id: Mapped[uuid.UUID] = _fk("code_repos.id")
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    added_by: Mapped[uuid.UUID | None] = _fk("users.id", "SET NULL", nullable=True, index=False)
    created_at: Mapped[datetime] = _now_column()


class GitAccessToken(Base):
    """Personal access token for `git clone/push` over HTTPS. Only a SHA-256 of it is stored."""

    __tablename__ = "git_access_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = _fk("users.id")
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = _now_column()


class BranchRule(Base):
    """A protected branch: no direct pushes or web edits; changes land through approved pull requests."""

    __tablename__ = "repo_branch_rules"
    __table_args__ = (UniqueConstraint("repo_id", "branch", name="uq_repo_branch_rules_repo_branch"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    repo_id: Mapped[uuid.UUID] = _fk("code_repos.id")
    branch: Mapped[str] = mapped_column(String(200), nullable=False)
    required_approvals: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_by: Mapped[uuid.UUID | None] = _fk("users.id", "SET NULL", nullable=True, index=False)
    created_at: Mapped[datetime] = _now_column()


class PullRequest(Base):
    __tablename__ = "pull_requests"
    __table_args__ = (UniqueConstraint("repo_id", "number", name="uq_pull_requests_repo_number"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    repo_id: Mapped[uuid.UUID] = _fk("code_repos.id")
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    author_id: Mapped[uuid.UUID | None] = _fk("users.id", "SET NULL", nullable=True)
    source_branch: Mapped[str] = mapped_column(String(200), nullable=False)
    target_branch: Mapped[str] = mapped_column(String(200), nullable=False)
    state: Mapped[str] = mapped_column(String(20), default="open", nullable=False, index=True)  # open|closed|merged
    draft: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reviewer_ids: Mapped[list] = mapped_column(JSON, default=list, nullable=False)  # requested reviewers
    head_sha: Mapped[str | None] = mapped_column(String(40), nullable=True)  # source tip when merged/closed
    base_sha: Mapped[str | None] = mapped_column(String(40), nullable=True)  # merge base when merged/closed
    merge_commit_sha: Mapped[str | None] = mapped_column(String(40), nullable=True)
    merge_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    merged_by: Mapped[uuid.UUID | None] = _fk("users.id", "SET NULL", nullable=True, index=False)
    merged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = _now_column()
    updated_at: Mapped[datetime] = _now_column(onupdate=True)


class PullRequestReview(Base):
    __tablename__ = "pull_request_reviews"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    pull_request_id: Mapped[uuid.UUID] = _fk("pull_requests.id")
    reviewer_id: Mapped[uuid.UUID | None] = _fk("users.id", "SET NULL", nullable=True)
    state: Mapped[str] = mapped_column(String(20), nullable=False)  # approved | changes_requested | commented
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    commit_sha: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = _now_column()


class RepoComment(Base):
    """A comment on an issue or a pull request; with `path`/`line` it is an inline code comment."""

    __tablename__ = "repo_comments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    repo_id: Mapped[uuid.UUID] = _fk("code_repos.id")
    issue_id: Mapped[uuid.UUID | None] = _fk("issues.id", nullable=True)
    pull_request_id: Mapped[uuid.UUID | None] = _fk("pull_requests.id", nullable=True)
    review_id: Mapped[uuid.UUID | None] = _fk("pull_request_reviews.id", "SET NULL", nullable=True, index=False)
    author_id: Mapped[uuid.UUID | None] = _fk("users.id", "SET NULL", nullable=True, index=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    line: Mapped[int | None] = mapped_column(Integer, nullable=True)
    side: Mapped[str | None] = mapped_column(String(5), nullable=True)  # "new" | "old"
    commit_sha: Mapped[str | None] = mapped_column(String(40), nullable=True)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = _now_column()


class RepoEvent(Base):
    """Activity and audit log of a repository (pushes, web commits, PRs, issues, settings, access)."""

    __tablename__ = "repo_events"
    __table_args__ = (
        Index("ix_repo_events_repo_created", "repo_id", "created_at"),
        Index("ix_repo_events_workspace_created", "workspace_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    repo_id: Mapped[uuid.UUID] = _fk("code_repos.id", index=False)
    workspace_id: Mapped[uuid.UUID] = _fk("workspaces.id", index=False)
    actor_id: Mapped[uuid.UUID | None] = _fk("users.id", "SET NULL", nullable=True, index=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = _now_column()
