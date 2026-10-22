"""Token revocation, account deactivation, and contact-form storage.

Additive only: two nullable/defaulted columns on users, messages.edited_at, and one new table. Existing rows keep
working (token_version starts at 0, so tokens issued before this migration stay valid until
their normal expiry).

Revision ID: 009_token_revocation_and_contact
Revises: 008_email_otp_and_google_auth
Create Date: 2026-10-22 08:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009_token_revocation_and_contact"
down_revision: Union[str, None] = "008_email_otp_and_google_auth"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _column_exists(table: str, column: str) -> bool:
    return column in [c["name"] for c in _inspector().get_columns(table)]


def upgrade() -> None:
    if not _column_exists("users", "token_version"):
        op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))
    if not _column_exists("users", "deactivated_at"):
        op.add_column("users", sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True))

    if not _column_exists("messages", "edited_at"):
        op.add_column("messages", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))

    if "contact_messages" not in _inspector().get_table_names():
        op.create_table(
            "contact_messages",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("email", sa.String(length=255), nullable=False),
            sa.Column("subject", sa.String(length=255), nullable=True),
            sa.Column("message", sa.Text(), nullable=False),
            sa.Column("client_ip_hash", sa.String(length=64), nullable=True),
            sa.Column("delivered", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    if "contact_messages" in _inspector().get_table_names():
        op.drop_table("contact_messages")
    if _column_exists("messages", "edited_at"):
        op.drop_column("messages", "edited_at")
    if _column_exists("users", "deactivated_at"):
        op.drop_column("users", "deactivated_at")
    if _column_exists("users", "token_version"):
        op.drop_column("users", "token_version")
