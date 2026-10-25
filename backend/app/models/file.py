import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base


class FileRecord(Base):
    __tablename__ = "files"
    __table_args__ = (
        # A retried upload (same client id from the same person) returns the stored file.
        UniqueConstraint("uploaded_by", "client_upload_id", name="uq_files_uploader_client_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("workspaces.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mime_type: Mapped[str] = mapped_column(String(128), nullable=False, default="application/octet-stream")
    # The Docs page made from this upload (Word/PDF/Markdown/text). The page is the editable
    # version; this row keeps the original. Deleting the page deletes the original too.
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("documents.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # Files sent in a chat belong to that conversation: only people who can read the channel or
    # meeting may open them, and they stay out of the workspace Files library.
    channel_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("channels.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    meeting_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    client_upload_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.now,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    workspace: Mapped["Workspace"] = relationship(back_populates="files")
    uploader: Mapped["User | None"] = relationship(foreign_keys=[uploaded_by])
