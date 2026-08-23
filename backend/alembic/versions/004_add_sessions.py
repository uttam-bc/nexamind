"""Add sessions table for Phase 5."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "004_add_sessions"
down_revision: Union[str, None] = "003_add_phase3_tables"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column(
            "source",
            sa.Enum("upload", "live", "notes", name="session_source", native_enum=False),
            nullable=False,
            server_default="upload",
        ),
        sa.Column("file_path", sa.String(length=1024), nullable=True),
        sa.Column("file_size", sa.Integer(), nullable=True),
        sa.Column("mime_type", sa.String(length=255), nullable=True),
        sa.Column("transcript", sa.Text(), nullable=True),
        sa.Column("ai_summary", sa.Text(), nullable=True),
        sa.Column(
            "action_items",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=True,
        ),
        sa.Column(
            "status",
            sa.Enum("uploading", "transcribing", "summarizing", "done", "failed", name="session_status", native_enum=False),
            nullable=False,
            server_default="uploading",
        ),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_sessions_created_by"), "sessions", ["created_by"], unique=False)
    op.create_index(op.f("ix_sessions_status"), "sessions", ["status"], unique=False)
    op.create_index(op.f("ix_sessions_workspace_id"), "sessions", ["workspace_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_sessions_workspace_id"), table_name="sessions")
    op.drop_index(op.f("ix_sessions_status"), table_name="sessions")
    op.drop_index(op.f("ix_sessions_created_by"), table_name="sessions")
    op.drop_table("sessions")
