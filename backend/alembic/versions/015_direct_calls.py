"""Calls from direct messages: meetings.channel_id links a call to its conversation.

Revision ID: 015_direct_calls
Revises: 014_git_repositories
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "015_direct_calls"
down_revision: Union[str, None] = "014_git_repositories"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    return column in [c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)]


def upgrade() -> None:
    if not _column_exists("meetings", "channel_id"):
        with op.batch_alter_table("meetings") as batch:
            batch.add_column(sa.Column("channel_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key("fk_meetings_channel_id", "channels", ["channel_id"], ["id"], ondelete="SET NULL")
            batch.create_index("ix_meetings_channel_id", ["channel_id"])


def downgrade() -> None:
    if _column_exists("meetings", "channel_id"):
        op.drop_index("ix_meetings_channel_id", table_name="meetings")
        with op.batch_alter_table("meetings") as batch:
            batch.drop_constraint("fk_meetings_channel_id", type_="foreignkey")
            batch.drop_column("channel_id")
