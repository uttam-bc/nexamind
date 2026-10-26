"""Notifications can be dismissed: notifications.dismissed_at hides one without deleting its dedupe key.

Revision ID: 016_notification_dismiss
Revises: 015_direct_calls
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "016_notification_dismiss"
down_revision: Union[str, None] = "015_direct_calls"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    return column in [c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)]


def upgrade() -> None:
    if not _column_exists("notifications", "dismissed_at"):
        with op.batch_alter_table("notifications") as batch:
            batch.add_column(sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    if _column_exists("notifications", "dismissed_at"):
        with op.batch_alter_table("notifications") as batch:
            batch.drop_column("dismissed_at")
