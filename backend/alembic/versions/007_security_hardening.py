"""Reconcile schema with the models, add channel membership, encrypted AI keys, memory embeddings.

Earlier releases created several tables (AI sessions/messages/memories, calendar events, repo
files) and the users.username column at app startup instead of in migrations, so a database
built only from migrations was incomplete. Every step below is conditional, which makes this
migration safe on fresh databases and on databases that already have some of these objects.

Revision ID: 007_security_hardening
Revises: 006_notion_teams_features
Create Date: 2026-10-20 10:00:00.000000

"""
import secrets
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007_security_hardening"
down_revision: Union[str, None] = "006_notion_teams_features"
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
    _users_username()

    if not _column_exists("users", "gemini_api_key_encrypted"):
        op.add_column("users", sa.Column("gemini_api_key_encrypted", sa.Text(), nullable=True))

    if not _table_exists("ai_sessions"):
        op.create_table(
            "ai_sessions",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("workspace_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index("ix_ai_sessions_user_id", "ai_sessions", ["user_id"])
    _create_index("ix_ai_sessions_workspace_id", "ai_sessions", ["workspace_id"])

    if not _table_exists("ai_messages"):
        op.create_table(
            "ai_messages",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("session_id", sa.Uuid(), nullable=False),
            sa.Column("role", sa.String(length=20), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("tool_calls", sa.JSON(), nullable=True),
            sa.Column("retrieved_memories", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
            sa.ForeignKeyConstraint(["session_id"], ["ai_sessions.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index("ix_ai_messages_session_id", "ai_messages", ["session_id"])

    if not _table_exists("ai_memories"):
        op.create_table(
            "ai_memories",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("workspace_id", sa.Uuid(), nullable=False),
            sa.Column("source_type", sa.String(length=50), nullable=False),
            sa.Column("source_id", sa.String(length=100), nullable=True),
            sa.Column("source_title", sa.String(length=255), nullable=True),
            sa.Column("memory_type", sa.String(length=50), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("tags", sa.JSON(), nullable=True),
            sa.Column("importance_score", sa.Float(), nullable=False),
            sa.Column("embedding", sa.JSON(), nullable=True),
            sa.Column("embedding_model", sa.String(length=100), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    else:
        if not _column_exists("ai_memories", "embedding"):
            op.add_column("ai_memories", sa.Column("embedding", sa.JSON(), nullable=True))
        if not _column_exists("ai_memories", "embedding_model"):
            op.add_column("ai_memories", sa.Column("embedding_model", sa.String(length=100), nullable=True))
    _create_index("ix_ai_memories_source_id", "ai_memories", ["source_id"])
    _create_index("ix_ai_memories_workspace_id", "ai_memories", ["workspace_id"])

    if not _table_exists("calendar_events"):
        op.create_table(
            "calendar_events",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("workspace_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("event_date", sa.String(length=32), nullable=False),
            sa.Column("event_time", sa.String(length=32), nullable=True),
            sa.Column("event_type", sa.Enum("MEETING", "DEADLINE", "REMINDER", "MILESTONE", "TASK",
                                            name="calendar_event_type", native_enum=False), nullable=False),
            sa.Column("priority", sa.Enum("LOW", "MEDIUM", "HIGH", "URGENT",
                                          name="calendar_event_priority", native_enum=False), nullable=False),
            sa.Column("source", sa.Enum("MANUAL", "AI_DETECTED", "MEETING_MOM", "DOCUMENT",
                                        name="calendar_event_source", native_enum=False), nullable=False),
            sa.Column("is_completed", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index("ix_calendar_events_user_id", "calendar_events", ["user_id"])
    _create_index("ix_calendar_events_workspace_id", "calendar_events", ["workspace_id"])

    if not _table_exists("repo_files"):
        op.create_table(
            "repo_files",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("repo_id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("language", sa.String(length=50), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
            sa.ForeignKeyConstraint(["repo_id"], ["code_repos.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    _create_index("ix_repo_files_repo_id", "repo_files", ["repo_id"])

    if not _table_exists("channel_members"):
        op.create_table(
            "channel_members",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("channel_id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
            sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("channel_id", "user_id", name="uq_channel_members_channel_user"),
        )
    _create_index("ix_channel_members_channel_id", "channel_members", ["channel_id"])
    _create_index("ix_channel_members_user_id", "channel_members", ["user_id"])

    if not _column_exists("channels", "is_direct"):
        op.add_column("channels", sa.Column("is_direct", sa.Boolean(), nullable=False, server_default=sa.false()))

    _backfill_private_channel_members()
    _self_reference_foreign_keys()


def _self_reference_foreign_keys() -> None:
    """Sub-pages and thread replies are deleted with their parent. SQLite can't add FKs in place."""
    if op.get_bind().dialect.name == "sqlite":
        return
    for table in ("documents", "messages"):
        has_fk = any(
            fk["referred_table"] == table and fk["constrained_columns"] == ["parent_id"]
            for fk in _inspector().get_foreign_keys(table)
        )
        if not has_fk:
            op.create_foreign_key(f"fk_{table}_parent_id", table, table, ["parent_id"], ["id"], ondelete="CASCADE")


def _users_username() -> None:
    """Add users.username if missing, fill blanks, make values unique, then index it."""
    bind = op.get_bind()
    if not _column_exists("users", "username"):
        op.add_column("users", sa.Column("username", sa.String(length=50), nullable=True))

    users = sa.table("users", sa.column("id", sa.Uuid()), sa.column("name", sa.String()),
                     sa.column("email", sa.String()), sa.column("username", sa.String()))
    taken: set[str] = set()
    for row in bind.execute(sa.select(users.c.id, users.c.name, users.c.email, users.c.username)).fetchall():
        base = (row.username or "").strip().lower()
        if not base:
            base = "".join(ch if ch.isalnum() or ch in "_-" else "_" for ch in (row.name or "").strip().lower())
        if len(base) < 2:
            base = (row.email or "user").split("@")[0].lower()
        base = base[:40] or "user"
        candidate = base
        while candidate in taken:
            candidate = f"{base}_{secrets.token_hex(2)}"
        taken.add(candidate)
        if candidate != row.username:
            bind.execute(users.update().where(users.c.id == row.id).values(username=candidate))
    _create_index("ix_users_username", "users", ["username"], unique=True)


def _backfill_private_channel_members() -> None:
    """Private channels used to be readable by the whole workspace; give each explicit members.

    DMs were named dm-<user1>-<user2> (or dm-<user>-notes). Other private channels keep their creator.
    """
    bind = op.get_bind()
    users = {row.username: row.id for row in bind.execute(sa.text("SELECT id, username FROM users WHERE username IS NOT NULL"))}
    channels = bind.execute(
        sa.text("SELECT id, name, created_by FROM channels WHERE is_private = :t"), {"t": True}
    ).fetchall()
    existing = {
        (str(_as_uuid(row.channel_id)), str(_as_uuid(row.user_id)))
        for row in bind.execute(sa.text("SELECT channel_id, user_id FROM channel_members"))
    }
    members_table = sa.table(
        "channel_members",
        sa.column("id", sa.Uuid()),
        sa.column("channel_id", sa.Uuid()),
        sa.column("user_id", sa.Uuid()),
    )
    channels_table = sa.table("channels", sa.column("id", sa.Uuid()), sa.column("is_direct", sa.Boolean()))

    rows = []
    for channel in channels:
        channel_id = _as_uuid(channel.id)
        member_ids = set()
        if channel.name.startswith("dm-"):
            body = channel.name[3:]
            if body.endswith("-notes") and body[: -len("-notes")] in users:
                member_ids.add(users[body[: -len("-notes")]])
            else:
                # Usernames may contain '-', so try every split point.
                for i in range(1, len(body)):
                    if body[i] == "-" and body[:i] in users and body[i + 1:] in users:
                        member_ids.update({users[body[:i]], users[body[i + 1:]]})
                        break
            if member_ids:
                bind.execute(channels_table.update().where(channels_table.c.id == channel_id).values(is_direct=True))
        if not member_ids and channel.created_by:
            member_ids.add(channel.created_by)
        for user_id in member_ids:
            key = (str(channel_id), str(_as_uuid(user_id)))
            if key not in existing:
                existing.add(key)
                rows.append({"id": uuid.uuid4(), "channel_id": channel_id, "user_id": _as_uuid(user_id)})
    if rows:
        op.bulk_insert(members_table, rows)


def _as_uuid(value) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    text = str(value)
    return uuid.UUID(text) if "-" in text else uuid.UUID(hex=text)


def downgrade() -> None:
    # Only objects introduced for the first time by this release are removed.
    if _column_exists("channels", "is_direct"):
        op.drop_column("channels", "is_direct")
    if _table_exists("channel_members"):
        op.drop_table("channel_members")
    if _table_exists("ai_memories"):
        for column in ("embedding_model", "embedding"):
            if _column_exists("ai_memories", column):
                op.drop_column("ai_memories", column)
    if _column_exists("users", "gemini_api_key_encrypted"):
        op.drop_column("users", "gemini_api_key_encrypted")
