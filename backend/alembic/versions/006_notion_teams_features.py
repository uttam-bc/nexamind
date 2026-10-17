"""Add Notion and Microsoft Teams features (threading, reactions, hierarchy, read states).

Revision ID: 006_notion_teams_features
Revises: 005_add_reports
Create Date: 2026-10-17 19:50:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "006_notion_teams_features"
down_revision: Union[str, None] = "005_add_reports"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    columns = [c["name"] for c in insp.get_columns(table_name)]
    return column_name in columns


def _table_exists(table_name: str) -> bool:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return table_name in insp.get_table_names()


def upgrade() -> None:
    # 1. Document hierarchy and icon (Notion-style)
    if not _column_exists("documents", "parent_id"):
        op.add_column("documents", sa.Column("parent_id", sa.Uuid(), nullable=True))
        op.create_index(op.f("ix_documents_parent_id"), "documents", ["parent_id"], unique=False)

    if not _column_exists("documents", "icon"):
        op.add_column("documents", sa.Column("icon", sa.String(length=32), nullable=True, server_default="📄"))

    # 2. Message threading (Teams-style)
    if not _column_exists("messages", "parent_id"):
        op.add_column("messages", sa.Column("parent_id", sa.Uuid(), nullable=True))
        op.create_index(op.f("ix_messages_parent_id"), "messages", ["parent_id"], unique=False)

    # 3. Message reactions (Teams-style)
    if not _table_exists("message_reactions"):
        op.create_table(
            "message_reactions",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("message_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("emoji", sa.String(length=32), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_user_emoji"),
        )
        op.create_index(op.f("ix_message_reactions_message_id"), "message_reactions", ["message_id"], unique=False)
        op.create_index(op.f("ix_message_reactions_user_id"), "message_reactions", ["user_id"], unique=False)

    # 4. Channel read states (Teams-style unread tracking)
    if not _table_exists("channel_read_states"):
        op.create_table(
            "channel_read_states",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("channel_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("last_read_message_id", sa.Uuid(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("channel_id", "user_id", name="uq_channel_read_states_channel_user"),
        )
        op.create_index(op.f("ix_channel_read_states_channel_id"), "channel_read_states", ["channel_id"], unique=False)
        op.create_index(op.f("ix_channel_read_states_user_id"), "channel_read_states", ["user_id"], unique=False)


def downgrade() -> None:
    if _table_exists("channel_read_states"):
        op.drop_table("channel_read_states")
    if _table_exists("message_reactions"):
        op.drop_table("message_reactions")
    if _column_exists("messages", "parent_id"):
        op.drop_index(op.f("ix_messages_parent_id"), table_name="messages")
        op.drop_column("messages", "parent_id")
    if _column_exists("documents", "icon"):
        op.drop_column("documents", "icon")
    if _column_exists("documents", "parent_id"):
        op.drop_index(op.f("ix_documents_parent_id"), table_name="documents")
        op.drop_column("documents", "parent_id")
