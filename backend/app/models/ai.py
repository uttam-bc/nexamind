import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.database import Base


class AiMemorySource(str, enum.Enum):
    DOCUMENT = "document"
    CHAT = "chat"
    TASK = "task"
    VIDEO_CALL = "video_call"
    CONVERSATION = "conversation"


class AiMemoryType(str, enum.Enum):
    FACT = "fact"
    DECISION = "decision"
    ACTION_ITEM = "action_item"
    SUMMARY = "summary"
    ENTITY = "entity"


class AiSession(Base):
    __tablename__ = "ai_sessions"

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
    title: Mapped[str] = mapped_column(String(255), default="New Chat Session", nullable=False)
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

    workspace: Mapped["Workspace"] = relationship(back_populates="ai_sessions")
    user: Mapped["User"] = relationship(back_populates="ai_sessions")
    messages: Mapped[list["AiMessage"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="AiMessage.created_at.asc()",
    )


class AiMessage(Base):
    __tablename__ = "ai_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("ai_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # 'user' | 'assistant' | 'system'
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tool_calls: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    retrieved_memories: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.now,
        server_default=func.current_timestamp(),
        nullable=False,
    )

    session: Mapped["AiSession"] = relationship(back_populates="messages")


class AiMemory(Base):
    """Long-term episodic and semantic memory for the Agentic AI.
    Workflow: Ingestion -> Extraction -> Consolidation -> Storage.
    Sources: Docs, Chat messages, Tasks, Video calls.
    """
    __tablename__ = "ai_memories"

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
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)  # 'document', 'chat', 'task', 'video_call'
    source_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    source_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    memory_type: Mapped[str] = mapped_column(String(50), default="fact", nullable=False)  # 'fact', 'decision', 'action_item', 'summary'
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True, default=list)
    importance_score: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
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

    workspace: Mapped["Workspace"] = relationship(back_populates="ai_memories")
