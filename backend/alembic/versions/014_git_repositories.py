"""Real Git repositories: repository settings, roles, push tokens, pull requests, reviews,
comments, protected branches, activity log, and numbered issues with labels/assignees/task links.

Existing repositories get a slug and keep `storage_key` empty; the app creates their bare Git
repository (importing the files saved by the old editor as a first commit) when one is opened.

Revision ID: 014_git_repositories
Revises: 013_chat_attachments
"""

import re
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014_git_repositories"
down_revision: Union[str, None] = "013_chat_attachments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _table_exists(table: str) -> bool:
    return table in _inspector().get_table_names()


def _column_exists(table: str, column: str) -> bool:
    return column in [c["name"] for c in _inspector().get_columns(table)]


def _unique_exists(table: str, name: str) -> bool:
    return name in {u["name"] for u in _inspector().get_unique_constraints(table)}


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9._-]+", "-", (name or "").lower()).strip("-.") or "repository"
    return slug[:90]


def _now():
    return sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp(), nullable=False)


def _backfill_repos() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, workspace_id, name, created_by FROM code_repos ORDER BY created_at")).fetchall()
    taken: dict = {}
    for repo_id, workspace_id, name, created_by in rows:
        used = taken.setdefault(str(workspace_id), set())
        base = _slugify(name)
        slug, n = base, 2
        while slug in used:
            slug = f"{base}-{n}"
            n += 1
        used.add(slug)
        bind.execute(
            sa.text("UPDATE code_repos SET slug = :slug, owner_id = :owner WHERE id = :id"),
            {"slug": slug, "owner": created_by, "id": repo_id},
        )


def _backfill_issue_numbers() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, repo_id FROM issues WHERE number IS NULL ORDER BY created_at")).fetchall()
    counters: dict = {}
    for issue_id, repo_id in rows:
        counters[repo_id] = counters.get(repo_id, 0) + 1
        bind.execute(sa.text("UPDATE issues SET number = :n WHERE id = :id"), {"n": counters[repo_id], "id": issue_id})
    for repo_id, count in counters.items():
        bind.execute(sa.text("UPDATE code_repos SET next_number = :n WHERE id = :id"), {"n": count + 1, "id": repo_id})


def upgrade() -> None:
    new_repo_columns = [
        sa.Column("slug", sa.String(100), nullable=True),
        sa.Column("visibility", sa.String(20), nullable=False, server_default="workspace"),
        sa.Column("member_role", sa.String(20), nullable=False, server_default="write"),
        sa.Column("default_branch", sa.String(200), nullable=False, server_default="main"),
        sa.Column("owner_id", sa.Uuid(), nullable=True),
        sa.Column("storage_key", sa.String(32), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="ready"),
        sa.Column("status_detail", sa.Text(), nullable=True),
        sa.Column("imported_from", sa.String(500), nullable=True),
        sa.Column("next_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("pushed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("backup_fingerprint", sa.String(64), nullable=True),
    ]
    missing = [c for c in new_repo_columns if not _column_exists("code_repos", c.name)]
    if missing:
        with op.batch_alter_table("code_repos") as batch:
            for column in missing:
                batch.add_column(column)
            if any(c.name == "owner_id" for c in missing):
                batch.create_foreign_key("fk_code_repos_owner_id", "users", ["owner_id"], ["id"], ondelete="SET NULL")
                batch.create_index("ix_code_repos_owner_id", ["owner_id"])
    _backfill_repos()
    with op.batch_alter_table("code_repos") as batch:
        batch.alter_column("slug", existing_type=sa.String(100), nullable=False)
        if not _unique_exists("code_repos", "uq_code_repos_workspace_slug"):
            batch.create_unique_constraint("uq_code_repos_workspace_slug", ["workspace_id", "slug"])
        if not _unique_exists("code_repos", "uq_code_repos_storage_key"):
            batch.create_unique_constraint("uq_code_repos_storage_key", ["storage_key"])

    issue_columns = [
        sa.Column("number", sa.Integer(), nullable=True),
        sa.Column("priority", sa.String(20), nullable=False, server_default="medium"),
        sa.Column("labels", sa.JSON(), nullable=True),
        sa.Column("milestone", sa.String(120), nullable=True),
        sa.Column("assignee_id", sa.Uuid(), nullable=True),
        sa.Column("task_id", sa.Uuid(), nullable=True),
        sa.Column("source_action_item_id", sa.Uuid(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_by", sa.Uuid(), nullable=True),
    ]
    missing = [c for c in issue_columns if not _column_exists("issues", c.name)]
    if missing:
        names = {c.name for c in missing}
        with op.batch_alter_table("issues") as batch:
            for column in missing:
                batch.add_column(column)
            if "assignee_id" in names:
                batch.create_foreign_key("fk_issues_assignee_id", "users", ["assignee_id"], ["id"], ondelete="SET NULL")
                batch.create_index("ix_issues_assignee_id", ["assignee_id"])
            if "task_id" in names:
                batch.create_foreign_key("fk_issues_task_id", "tasks", ["task_id"], ["id"], ondelete="SET NULL")
            if "source_action_item_id" in names:
                batch.create_foreign_key("fk_issues_source_action_item_id", "meeting_action_items",
                                         ["source_action_item_id"], ["id"], ondelete="SET NULL")
            if "closed_by" in names:
                batch.create_foreign_key("fk_issues_closed_by", "users", ["closed_by"], ["id"], ondelete="SET NULL")
    op.execute(sa.text("UPDATE issues SET labels = '[]' WHERE labels IS NULL"))
    _backfill_issue_numbers()
    with op.batch_alter_table("issues") as batch:
        batch.alter_column("labels", existing_type=sa.JSON(), nullable=False)
        for name, cols in (
            ("uq_issues_repo_number", ["repo_id", "number"]),
            ("uq_issues_task_id", ["task_id"]),
            ("uq_issues_source_action_item_id", ["source_action_item_id"]),
        ):
            if not _unique_exists("issues", name):
                batch.create_unique_constraint(name, cols)

    def fk(column, target, ondelete="CASCADE", nullable=False):
        return sa.Column(column, sa.Uuid(), sa.ForeignKey(target, ondelete=ondelete), nullable=nullable)

    if not _table_exists("repo_collaborators"):
        op.create_table(
            "repo_collaborators",
            sa.Column("id", sa.Uuid(), primary_key=True),
            fk("repo_id", "code_repos.id"),
            fk("user_id", "users.id"),
            sa.Column("role", sa.String(20), nullable=False),
            fk("added_by", "users.id", "SET NULL", True),
            _now(),
            sa.UniqueConstraint("repo_id", "user_id", name="uq_repo_collaborators_repo_user"),
        )
        op.create_index("ix_repo_collaborators_repo_id", "repo_collaborators", ["repo_id"])
        op.create_index("ix_repo_collaborators_user_id", "repo_collaborators", ["user_id"])

    if not _table_exists("git_access_tokens"):
        op.create_table(
            "git_access_tokens",
            sa.Column("id", sa.Uuid(), primary_key=True),
            fk("user_id", "users.id"),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
            sa.Column("prefix", sa.String(16), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            _now(),
        )
        op.create_index("ix_git_access_tokens_user_id", "git_access_tokens", ["user_id"])

    if not _table_exists("repo_branch_rules"):
        op.create_table(
            "repo_branch_rules",
            sa.Column("id", sa.Uuid(), primary_key=True),
            fk("repo_id", "code_repos.id"),
            sa.Column("branch", sa.String(200), nullable=False),
            sa.Column("required_approvals", sa.Integer(), nullable=False, server_default="1"),
            fk("created_by", "users.id", "SET NULL", True),
            _now(),
            sa.UniqueConstraint("repo_id", "branch", name="uq_repo_branch_rules_repo_branch"),
        )
        op.create_index("ix_repo_branch_rules_repo_id", "repo_branch_rules", ["repo_id"])

    if not _table_exists("pull_requests"):
        op.create_table(
            "pull_requests",
            sa.Column("id", sa.Uuid(), primary_key=True),
            fk("repo_id", "code_repos.id"),
            sa.Column("number", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("body", sa.Text(), nullable=True),
            fk("author_id", "users.id", "SET NULL", True),
            sa.Column("source_branch", sa.String(200), nullable=False),
            sa.Column("target_branch", sa.String(200), nullable=False),
            sa.Column("state", sa.String(20), nullable=False, server_default="open"),
            sa.Column("draft", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("reviewer_ids", sa.JSON(), nullable=False),
            sa.Column("head_sha", sa.String(40), nullable=True),
            sa.Column("base_sha", sa.String(40), nullable=True),
            sa.Column("merge_commit_sha", sa.String(40), nullable=True),
            sa.Column("merge_method", sa.String(20), nullable=True),
            fk("merged_by", "users.id", "SET NULL", True),
            sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            _now(),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp(), nullable=False),
            sa.UniqueConstraint("repo_id", "number", name="uq_pull_requests_repo_number"),
        )
        op.create_index("ix_pull_requests_repo_id", "pull_requests", ["repo_id"])
        op.create_index("ix_pull_requests_author_id", "pull_requests", ["author_id"])
        op.create_index("ix_pull_requests_state", "pull_requests", ["state"])

    if not _table_exists("pull_request_reviews"):
        op.create_table(
            "pull_request_reviews",
            sa.Column("id", sa.Uuid(), primary_key=True),
            fk("pull_request_id", "pull_requests.id"),
            fk("reviewer_id", "users.id", "SET NULL", True),
            sa.Column("state", sa.String(20), nullable=False),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("commit_sha", sa.String(40), nullable=False),
            _now(),
        )
        op.create_index("ix_pull_request_reviews_pull_request_id", "pull_request_reviews", ["pull_request_id"])
        op.create_index("ix_pull_request_reviews_reviewer_id", "pull_request_reviews", ["reviewer_id"])

    if not _table_exists("repo_comments"):
        op.create_table(
            "repo_comments",
            sa.Column("id", sa.Uuid(), primary_key=True),
            fk("repo_id", "code_repos.id"),
            fk("issue_id", "issues.id", nullable=True),
            fk("pull_request_id", "pull_requests.id", nullable=True),
            fk("review_id", "pull_request_reviews.id", "SET NULL", True),
            fk("author_id", "users.id", "SET NULL", True),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("path", sa.String(1024), nullable=True),
            sa.Column("line", sa.Integer(), nullable=True),
            sa.Column("side", sa.String(5), nullable=True),
            sa.Column("commit_sha", sa.String(40), nullable=True),
            sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
            _now(),
        )
        op.create_index("ix_repo_comments_repo_id", "repo_comments", ["repo_id"])
        op.create_index("ix_repo_comments_issue_id", "repo_comments", ["issue_id"])
        op.create_index("ix_repo_comments_pull_request_id", "repo_comments", ["pull_request_id"])

    if not _table_exists("repo_events"):
        op.create_table(
            "repo_events",
            sa.Column("id", sa.Uuid(), primary_key=True),
            fk("repo_id", "code_repos.id"),
            fk("workspace_id", "workspaces.id"),
            fk("actor_id", "users.id", "SET NULL", True),
            sa.Column("kind", sa.String(40), nullable=False),
            sa.Column("summary", sa.String(500), nullable=False),
            sa.Column("data", sa.JSON(), nullable=False),
            _now(),
        )
        op.create_index("ix_repo_events_repo_created", "repo_events", ["repo_id", "created_at"])
        op.create_index("ix_repo_events_workspace_created", "repo_events", ["workspace_id", "created_at"])


def downgrade() -> None:
    for table in ("repo_events", "repo_comments", "pull_request_reviews", "pull_requests", "repo_branch_rules",
                  "git_access_tokens", "repo_collaborators"):
        if _table_exists(table):
            op.drop_table(table)
    with op.batch_alter_table("issues") as batch:
        for name in ("uq_issues_repo_number", "uq_issues_task_id", "uq_issues_source_action_item_id"):
            if _unique_exists("issues", name):
                batch.drop_constraint(name, type_="unique")
    for table, index in (("issues", "ix_issues_assignee_id"), ("code_repos", "ix_code_repos_owner_id")):
        if index in {i["name"] for i in _inspector().get_indexes(table)}:
            op.drop_index(index, table_name=table)
    with op.batch_alter_table("issues") as batch:
        for fk_name in ("fk_issues_assignee_id", "fk_issues_task_id", "fk_issues_source_action_item_id", "fk_issues_closed_by"):
            if fk_name in {f["name"] for f in _inspector().get_foreign_keys("issues")}:
                batch.drop_constraint(fk_name, type_="foreignkey")
        for column in ("number", "priority", "labels", "milestone", "assignee_id", "task_id", "source_action_item_id",
                       "closed_at", "closed_by"):
            if _column_exists("issues", column):
                batch.drop_column(column)
    with op.batch_alter_table("code_repos") as batch:
        for name in ("uq_code_repos_workspace_slug", "uq_code_repos_storage_key"):
            if _unique_exists("code_repos", name):
                batch.drop_constraint(name, type_="unique")
    with op.batch_alter_table("code_repos") as batch:
        if "fk_code_repos_owner_id" in {f["name"] for f in _inspector().get_foreign_keys("code_repos")}:
            batch.drop_constraint("fk_code_repos_owner_id", type_="foreignkey")
        for column in ("slug", "visibility", "member_role", "default_branch", "owner_id", "storage_key", "status",
                       "status_detail", "imported_from", "next_number", "pushed_at", "backup_fingerprint"):
            if _column_exists("code_repos", column):
                batch.drop_column(column)

