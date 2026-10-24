"""Meetings as real records, transcript segments, meeting chat, MoM action items, notifications.

Additive only: new tables and nullable columns. Live video rooms used to exist only in server
memory; meetings are now stored, so scheduling, joining and ending survive restarts.

Revision ID: 011_meetings_notifications
Revises: 010_link_files_to_documents
Create Date: 2026-10-24 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "011_meetings_notifications"
down_revision: Union[str, None] = "010_link_files_to_documents"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector():
    return sa.inspect(op.get_bind())


def _table_exists(table: str) -> bool:
    return table in _inspector().get_table_names()


def _column_exists(table: str, column: str) -> bool:
    return column in [c["name"] for c in _inspector().get_columns(table)]


def _ts(name: str, nullable: bool = False):
    return sa.Column(name, sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=nullable)


def _add_column(table: str, column: sa.Column, fk: tuple | None = None, index: bool = False) -> None:
    if _column_exists(table, column.name):
        return
    with op.batch_alter_table(table) as batch:
        batch.add_column(column)
        if fk:
            batch.create_foreign_key(f"fk_{table}_{column.name}", fk[0], [column.name], ["id"], ondelete=fk[1])
        if index:
            batch.create_index(f"ix_{table}_{column.name}", [column.name])


def upgrade() -> None:
    if not _table_exists("meetings"):
        op.create_table(
            "meetings",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("agenda", sa.Text(), nullable=True),
            sa.Column("organizer_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(32), nullable=False, server_default="scheduled"),
            sa.Column("scheduled_start", sa.DateTime(timezone=True), nullable=True),
            sa.Column("duration_minutes", sa.Integer(), nullable=False, server_default="30"),
            sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
            sa.Column("recurrence", sa.String(32), nullable=False, server_default="none"),
            sa.Column("recurrence_parent_id", sa.Uuid(), sa.ForeignKey("meetings.id", ondelete="SET NULL"), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("ended_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("transcription_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("session_id", sa.Uuid(), sa.ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("client_request_id", sa.String(64), nullable=True),
            _ts("created_at"),
            _ts("updated_at"),
            sa.UniqueConstraint("organizer_id", "client_request_id", name="uq_meetings_organizer_request"),
        )
        for col in ("workspace_id", "organizer_id", "scheduled_start", "recurrence_parent_id"):
            op.create_index(f"ix_meetings_{col}", "meetings", [col])

    if not _table_exists("meeting_invitees"):
        op.create_table(
            "meeting_invitees",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("meeting_id", sa.Uuid(), sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            _ts("created_at"),
            sa.UniqueConstraint("meeting_id", "user_id", name="uq_meeting_invitees_meeting_user"),
        )

    if not _table_exists("meeting_transcript_segments"):
        op.create_table(
            "meeting_transcript_segments",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("meeting_id", sa.Uuid(), sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("speaker_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("speaker_name", sa.String(255), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("offset_ms", sa.Integer(), nullable=False, server_default="0", index=True),
            sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("source", sa.String(16), nullable=False, server_default="server"),
            sa.Column("client_segment_id", sa.String(80), nullable=False),
            _ts("created_at"),
            sa.UniqueConstraint("meeting_id", "client_segment_id", name="uq_transcript_segment_client_id"),
        )

    if not _table_exists("meeting_messages"):
        op.create_table(
            "meeting_messages",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("meeting_id", sa.Uuid(), sa.ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("sender_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("sender_name", sa.String(255), nullable=False),
            sa.Column("content", sa.Text(), nullable=False),
            sa.Column("client_message_id", sa.String(80), nullable=False),
            _ts("created_at"),
            sa.UniqueConstraint("meeting_id", "client_message_id", name="uq_meeting_messages_client_id"),
        )
        op.create_index("ix_meeting_messages_created_at", "meeting_messages", ["created_at"])

    if not _table_exists("meeting_action_items"):
        op.create_table(
            "meeting_action_items",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("session_id", sa.Uuid(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("meeting_id", sa.Uuid(), sa.ForeignKey("meetings.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column("owner_text", sa.String(255), nullable=True),
            sa.Column("assignee_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("due_date", sa.String(10), nullable=True),
            sa.Column("evidence", sa.Text(), nullable=True),
            sa.Column("needs_review", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("status", sa.String(32), nullable=False, server_default="proposed"),
            sa.Column("task_id", sa.Uuid(), sa.ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True),
            sa.Column("dedupe_key", sa.String(64), nullable=False),
            _ts("created_at"),
            _ts("updated_at"),
            sa.UniqueConstraint("session_id", "dedupe_key", name="uq_action_items_session_key"),
        )

    if not _table_exists("notifications"):
        op.create_table(
            "notifications",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("workspace_id", sa.Uuid(), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=True, index=True),
            sa.Column("kind", sa.String(40), nullable=False),
            sa.Column("category", sa.String(20), nullable=False),
            sa.Column("title", sa.String(255), nullable=False),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("link", sa.JSON(), nullable=True),
            sa.Column("dedupe_key", sa.String(160), nullable=False),
            sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
            _ts("created_at"),
            sa.UniqueConstraint("user_id", "dedupe_key", name="uq_notifications_user_key"),
        )
        op.create_index("ix_notifications_created_at", "notifications", ["created_at"])

    _add_column("tasks", sa.Column("source_meeting_id", sa.Uuid(), nullable=True), ("meetings", "SET NULL"), index=True)
    _add_column("tasks", sa.Column("source_session_id", sa.Uuid(), nullable=True), ("sessions", "SET NULL"))
    _add_column("sessions", sa.Column("meeting_id", sa.Uuid(), nullable=True), ("meetings", "SET NULL"), index=True)
    _add_column("sessions", sa.Column("mom_status", sa.String(16), nullable=False, server_default="draft"))
    _add_column("sessions", sa.Column("mom_data", sa.JSON(), nullable=True))
    _add_column("sessions", sa.Column("mom_approved_by", sa.Uuid(), nullable=True), ("users", "SET NULL"))
    _add_column("sessions", sa.Column("mom_approved_at", sa.DateTime(timezone=True), nullable=True))
    _add_column("calendar_events", sa.Column("meeting_id", sa.Uuid(), nullable=True), ("meetings", "CASCADE"), index=True)
    _add_column("users", sa.Column("notification_prefs", sa.JSON(), nullable=True))


def downgrade() -> None:
    for table, column in (
        ("users", "notification_prefs"),
        ("calendar_events", "meeting_id"),
        ("sessions", "mom_approved_at"),
        ("sessions", "mom_approved_by"),
        ("sessions", "mom_data"),
        ("sessions", "mom_status"),
        ("sessions", "meeting_id"),
        ("tasks", "source_session_id"),
        ("tasks", "source_meeting_id"),
    ):
        if not _column_exists(table, column):
            continue
        indexes = {ix["name"] for ix in _inspector().get_indexes(table)}
        foreign_keys = {fk["name"] for fk in _inspector().get_foreign_keys(table) if fk.get("name")}
        with op.batch_alter_table(table) as batch:
            if f"ix_{table}_{column}" in indexes:
                batch.drop_index(f"ix_{table}_{column}")
            if f"fk_{table}_{column}" in foreign_keys:
                batch.drop_constraint(f"fk_{table}_{column}", type_="foreignkey")
            batch.drop_column(column)
    for table in ("notifications", "meeting_action_items", "meeting_messages", "meeting_transcript_segments",
                  "meeting_invitees", "meetings"):
        if _table_exists(table):
            op.drop_table(table)
