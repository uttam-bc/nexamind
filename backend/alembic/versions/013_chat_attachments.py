"""Chat attachments: files sent in a conversation, shared library files/pages, retry-safe messages.

Revision ID: 013_chat_attachments
Revises: 012_meeting_chat_replies
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "013_chat_attachments"
down_revision: Union[str, None] = "012_meeting_chat_replies"
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


def upgrade() -> None:
    with op.batch_alter_table("files") as batch:
        if not _column_exists("files", "channel_id"):
            batch.add_column(sa.Column("channel_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key("fk_files_channel_id", "channels", ["channel_id"], ["id"], ondelete="CASCADE")
            batch.create_index("ix_files_channel_id", ["channel_id"])
        if not _column_exists("files", "meeting_id"):
            batch.add_column(sa.Column("meeting_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key("fk_files_meeting_id", "meetings", ["meeting_id"], ["id"], ondelete="CASCADE")
            batch.create_index("ix_files_meeting_id", ["meeting_id"])
        if not _column_exists("files", "client_upload_id"):
            batch.add_column(sa.Column("client_upload_id", sa.String(80), nullable=True))
    if not _unique_exists("files", "uq_files_uploader_client_id"):
        with op.batch_alter_table("files") as batch:
            batch.create_unique_constraint("uq_files_uploader_client_id", ["uploaded_by", "client_upload_id"])

    if not _column_exists("messages", "client_message_id"):
        with op.batch_alter_table("messages") as batch:
            batch.add_column(sa.Column("client_message_id", sa.String(80), nullable=True))
    if not _unique_exists("messages", "uq_messages_channel_client_id"):
        with op.batch_alter_table("messages") as batch:
            batch.create_unique_constraint("uq_messages_channel_client_id", ["channel_id", "client_message_id"])

    if not _table_exists("message_attachments"):
        op.create_table(
            "message_attachments",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("message_id", sa.Uuid(), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=True),
            sa.Column("meeting_message_id", sa.Uuid(), sa.ForeignKey("meeting_messages.id", ondelete="CASCADE"), nullable=True),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("file_id", sa.Uuid(), sa.ForeignKey("files.id", ondelete="SET NULL"), nullable=True),
            sa.Column("document_id", sa.Uuid(), sa.ForeignKey("documents.id", ondelete="SET NULL"), nullable=True),
            sa.Column("source_workspace_id", sa.Uuid(), nullable=True),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("mime_type", sa.String(128), nullable=True),
            sa.Column("size", sa.Integer(), nullable=True),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("shared_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        )
        for column in ("message_id", "meeting_message_id", "file_id", "document_id"):
            op.create_index(f"ix_message_attachments_{column}", "message_attachments", [column])


def downgrade() -> None:
    if _table_exists("message_attachments"):
        op.drop_table("message_attachments")
    if _column_exists("messages", "client_message_id"):
        with op.batch_alter_table("messages") as batch:
            if _unique_exists("messages", "uq_messages_channel_client_id"):
                batch.drop_constraint("uq_messages_channel_client_id", type_="unique")
            batch.drop_column("client_message_id")
    with op.batch_alter_table("files") as batch:
        if _unique_exists("files", "uq_files_uploader_client_id"):
            batch.drop_constraint("uq_files_uploader_client_id", type_="unique")
        indexes = {ix["name"] for ix in _inspector().get_indexes("files")}
        fks = {fk["name"] for fk in _inspector().get_foreign_keys("files") if fk.get("name")}
        for column in ("meeting_id", "channel_id"):
            if _column_exists("files", column):
                if f"ix_files_{column}" in indexes:
                    batch.drop_index(f"ix_files_{column}")
                if f"fk_files_{column}" in fks:
                    batch.drop_constraint(f"fk_files_{column}", type_="foreignkey")
                batch.drop_column(column)
        if _column_exists("files", "client_upload_id"):
            batch.drop_column("client_upload_id")
