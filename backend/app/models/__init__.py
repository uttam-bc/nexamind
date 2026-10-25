import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON, Uuid

from app.database import Base
from app.models.channel import (  # noqa: F401
    AttachmentKind,
    Channel,
    ChannelMember,
    ChannelReadState,
    Message,
    MessageAttachment,
    MessageReaction,
)
from app.models.document import Document  # noqa: F401
from app.models.file import FileRecord  # noqa: F401
from app.models.finance import FinanceTransaction  # noqa: F401
from app.models.project import CodeRepo, Commit, Issue, RepoFile, Task  # noqa: F401
from app.models.repository import (  # noqa: F401
    BranchRule,
    GitAccessToken,
    PullRequest,
    PullRequestReview,
    RepoCollaborator,
    RepoComment,
    RepoEvent,
)
from app.models.report import ReportRecord, ReportType  # noqa: F401
from app.models.session import SessionRecord, SessionSource, SessionStatus  # noqa: F401
from app.models.calendar import (  # noqa: F401
    CalendarEvent,
    CalendarEventType,
    CalendarEventPriority,
    CalendarEventSource,
)
from app.models.ai import AiSession, AiMessage, AiMemory, AiMemoryType, AiMemorySource  # noqa: F401
from app.models.meeting import (  # noqa: F401
    ActionItemStatus,
    Meeting,
    MeetingActionItem,
    MeetingInvitee,
    MeetingMessage,
    MeetingRecurrence,
    MeetingStatus,
    Notification,
    TranscriptSegment,
)



class WorkspaceType(str, enum.Enum):
    PERSONAL = "personal"
    TEAM = "team"


class WorkspaceRole(str, enum.Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True, index=True)
    # Personal Gemini API key, Fernet-encrypted (see app.security).
    gemini_api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_email_verified: Mapped[bool] = mapped_column(Boolean, default=True, server_default=func.true(), nullable=False)
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # Incremented on logout, password change/reset and deactivation; tokens carry the value they
    # were issued with, so bumping it revokes every outstanding token for the user.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # Set when the account is deleted. The row is kept (anonymised) so shared content stays intact.
    # Notification categories the user turned off, e.g. {"messages": false}.
    notification_prefs: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.now,
        server_default=func.current_timestamp(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.now,
        server_default=func.current_timestamp(),
        onupdate=datetime.now,
        nullable=False,
    )

    owned_workspaces: Mapped[list["Workspace"]] = relationship(
        back_populates="owner",
        foreign_keys="Workspace.owner_id",
    )
    memberships: Mapped[list["WorkspaceMember"]] = relationship(back_populates="user")
    ai_sessions: Mapped[list["AiSession"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[WorkspaceType] = mapped_column(
        Enum(WorkspaceType, name="workspace_type", native_enum=False),
        nullable=False,
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    join_code: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.now,
        server_default=func.current_timestamp(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.now,
        server_default=func.current_timestamp(),
        onupdate=datetime.now,
        nullable=False,
    )

    owner: Mapped["User"] = relationship(back_populates="owned_workspaces", foreign_keys=[owner_id])
    members: Mapped[list["WorkspaceMember"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    documents: Mapped[list["Document"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    code_repos: Mapped[list["CodeRepo"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    files: Mapped[list["FileRecord"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    finance_transactions: Mapped[list["FinanceTransaction"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    channels: Mapped[list["Channel"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    sessions: Mapped[list["SessionRecord"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    reports: Mapped[list["ReportRecord"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    calendar_events: Mapped[list["CalendarEvent"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    ai_sessions: Mapped[list["AiSession"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )
    ai_memories: Mapped[list["AiMemory"]] = relationship(
        back_populates="workspace",
        cascade="all, delete-orphan",
    )




class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_workspace_members_workspace_user"),
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
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[WorkspaceRole] = mapped_column(
        Enum(WorkspaceRole, name="workspace_role", native_enum=False),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.now,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    workspace: Mapped["Workspace"] = relationship(back_populates="members")
    user: Mapped["User"] = relationship(back_populates="memberships")


class EmailVerification(Base):
    __tablename__ = "email_verifications"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    otp_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    purpose: Mapped[str] = mapped_column(String(50), default="register", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.now,
        server_default=func.current_timestamp(),
        nullable=False,
    )


class ContactMessage(Base):
    """Messages sent through the public contact form."""

    __tablename__ = "contact_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    client_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    delivered: Mapped[bool] = mapped_column(Boolean, default=False, server_default=func.false(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.now,
        server_default=func.current_timestamp(),
        nullable=False,
    )
