"""Add email verification table, is_email_verified, google_id, and avatar_url to users.

Revision ID: 008_email_otp_and_google_auth
Revises: 007_security_hardening
Create Date: 2026-10-21 16:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008_email_otp_and_google_auth"
down_revision: Union[str, None] = "007_security_hardening"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NOW = sa.text("CURRENT_TIMESTAMP")


def _inspector():
    return sa.inspect(op.get_bind())


def _table_exists(name: str) -> bool:
    return name in _inspector().get_table_names()


def _column_exists(table: str, column: str) -> bool:
    return column in [c["name"] for c in _inspector().get_columns(table)]


def _index_exists(table: str, index: str) -> bool:
    return index in [i["name"] for i in _inspector().get_indexes(table)]


def _create_index(name: str, table: str, columns: list[str], unique: bool = False) -> None:
    if not _index_exists(table, name):
        op.create_index(name, table, columns, unique=unique)


def upgrade() -> None:
    # 1. Update users table with new auth columns if missing
    if _table_exists("users"):
        if not _column_exists("users", "is_email_verified"):
            op.add_column("users", sa.Column("is_email_verified", sa.Boolean(), server_default=sa.true(), nullable=False))
        if not _column_exists("users", "google_id"):
            op.add_column("users", sa.Column("google_id", sa.String(255), nullable=True))
            _create_index("ix_users_google_id", "users", ["google_id"], unique=True)
        if not _column_exists("users", "avatar_url"):
            op.add_column("users", sa.Column("avatar_url", sa.String(1024), nullable=True))

    # 2. Create email_verifications table
    if not _table_exists("email_verifications"):
        op.create_table(
            "email_verifications",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("email", sa.String(255), nullable=False),
            sa.Column("otp_hash", sa.String(255), nullable=False),
            sa.Column("purpose", sa.String(50), server_default="register", nullable=False),
            sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
            sa.Column("is_verified", sa.Boolean(), server_default=sa.false(), nullable=False),
            sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        )
        _create_index("ix_email_verifications_email", "email_verifications", ["email"])
        _create_index("ix_email_verifications_created_at", "email_verifications", ["created_at"])


def downgrade() -> None:
    if _table_exists("email_verifications"):
        op.drop_table("email_verifications")

    if _table_exists("users"):
        if _column_exists("users", "avatar_url"):
            op.drop_column("users", "avatar_url")
        if _column_exists("users", "google_id"):
            op.drop_column("users", "google_id")
        if _column_exists("users", "is_email_verified"):
            op.drop_column("users", "is_email_verified")
