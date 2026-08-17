from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, Message, User
from app.schemas.channel import ChannelCreate, MessageCreate
from app.services.auth_service import AuthError
from app.services.workspace_service import get_workspace_membership


async def list_channels(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> list[Channel]:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(Channel)
        .where(Channel.workspace_id == workspace_id)
        .order_by(Channel.created_at.asc())
    )
    channels = list(result.scalars().all())
    # Ensure default 'general' channel exists if workspace has no channels
    if not channels:
        default_channel = Channel(
            workspace_id=workspace_id,
            name="general",
            description="General team channel",
            is_private=False,
            created_by=user_id,
        )
        db.add(default_channel)
        await db.flush()
        await db.refresh(default_channel)
        channels.append(default_channel)

    return channels


async def create_channel(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    data: ChannelCreate,
) -> Channel:
    await _require_workspace_access(db, workspace_id, user.id)
    channel = Channel(
        workspace_id=workspace_id,
        name=data.name.strip().lower(),
        description=data.description.strip() if data.description else None,
        is_private=data.is_private,
        created_by=user.id,
    )
    db.add(channel)
    await db.flush()
    await db.refresh(channel)
    return channel


async def get_channel(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    user_id: UUID,
) -> Channel:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(Channel).where(
            Channel.id == channel_id,
            Channel.workspace_id == workspace_id,
        )
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise AuthError("Channel not found", status_code=404)
    return channel


async def list_messages(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    user_id: UUID,
    limit: int = 50,
) -> list[Message]:
    await get_channel(db, workspace_id, channel_id, user_id)
    result = await db.execute(
        select(Message)
        .where(Message.channel_id == channel_id, Message.workspace_id == workspace_id)
        .order_by(Message.created_at.asc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def post_message(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    user: User,
    data: MessageCreate,
) -> Message:
    await get_channel(db, workspace_id, channel_id, user.id)
    message = Message(
        workspace_id=workspace_id,
        channel_id=channel_id,
        sender_id=user.id,
        content=data.content.strip(),
    )
    db.add(message)
    await db.flush()
    await db.refresh(message)
    return message


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
