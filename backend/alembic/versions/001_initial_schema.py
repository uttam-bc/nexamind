"""Initial schema: users, workspaces, workspace_members."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "workspaces",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.Enum("personal", "team", name="workspace_type", native_enum=False), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("join_code", sa.String(length=32), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_workspaces_join_code"), "workspaces", ["join_code"], unique=True)
    op.create_index(op.f("ix_workspaces_owner_id"), "workspaces", ["owner_id"], unique=False)

    op.create_table(
        "workspace_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.Enum("owner", "admin", "member", name="workspace_role", native_enum=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_workspace_user"),
    )
    op.create_index(op.f("ix_workspace_members_user_id"), "workspace_members", ["user_id"], unique=False)
    op.create_index(op.f("ix_workspace_members_workspace_id"), "workspace_members", ["workspace_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_workspace_members_workspace_id"), table_name="workspace_members")
    op.drop_index(op.f("ix_workspace_members_user_id"), table_name="workspace_members")
    op.drop_table("workspace_members")
    op.drop_index(op.f("ix_workspaces_owner_id"), table_name="workspaces")
    op.drop_index(op.f("ix_workspaces_join_code"), table_name="workspaces")
    op.drop_table("workspaces")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
