"""Replies in meeting chat (reply_to_id) and a notification list index.

Revision ID: 012_meeting_chat_replies
Revises: 011_meetings_notifications
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "012_meeting_chat_replies"
down_revision: Union[str, None] = "011_meetings_notifications"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _column_exists(table: str, column: str) -> bool:
    return column in [c["name"] for c in _inspector().get_columns(table)]


def _index_exists(table: str, name: str) -> bool:
    return name in {ix["name"] for ix in _inspector().get_indexes(table)}


def upgrade() -> None:
    if not _column_exists("meeting_messages", "reply_to_id"):
        with op.batch_alter_table("meeting_messages") as batch:
            batch.add_column(sa.Column("reply_to_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key("fk_meeting_messages_reply_to_id", "meeting_messages", ["reply_to_id"], ["id"],
                                     ondelete="SET NULL")
            batch.create_index("ix_meeting_messages_reply_to_id", ["reply_to_id"])
    if not _index_exists("notifications", "ix_notifications_user_created"):
        op.create_index("ix_notifications_user_created", "notifications", ["user_id", "created_at"])


def downgrade() -> None:
    if _index_exists("notifications", "ix_notifications_user_created"):
        op.drop_index("ix_notifications_user_created", table_name="notifications")
    if _column_exists("meeting_messages", "reply_to_id"):
        with op.batch_alter_table("meeting_messages") as batch:
            if _index_exists("meeting_messages", "ix_meeting_messages_reply_to_id"):
                batch.drop_index("ix_meeting_messages_reply_to_id")
            batch.drop_constraint("fk_meeting_messages_reply_to_id", type_="foreignkey")
            batch.drop_column("reply_to_id")
