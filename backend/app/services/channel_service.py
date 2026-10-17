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


from sqlalchemy.orm import selectinload

from app.models import Channel, ChannelReadState, Message, MessageReaction, User


async def list_messages(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    user_id: UUID,
    parent_id: UUID | None = None,
    root_only: bool = False,
    limit: int = 100,
) -> list[dict]:
    await get_channel(db, workspace_id, channel_id, user_id)
    query = (
        select(Message)
        .options(
            selectinload(Message.sender),
            selectinload(Message.reactions),
            selectinload(Message.replies),
        )
        .where(Message.channel_id == channel_id, Message.workspace_id == workspace_id)
    )

    if parent_id is not None:
        query = query.where(Message.parent_id == parent_id)
    elif root_only:
        query = query.where(Message.parent_id.is_(None))

    query = query.order_by(Message.created_at.asc()).limit(limit)
    result = await db.execute(query)
    messages = list(result.scalars().all())

    return [format_message_dict(msg, user_id) for msg in messages]


async def post_message(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    user: User,
    data: MessageCreate,
) -> dict:
    await get_channel(db, workspace_id, channel_id, user.id)

    if data.parent_id:
        parent_result = await db.execute(
            select(Message).where(
                Message.id == data.parent_id,
                Message.channel_id == channel_id,
                Message.workspace_id == workspace_id,
            )
        )
        parent = parent_result.scalar_one_or_none()
        if not parent:
            raise AuthError("Parent message not found in this channel", status_code=404)

    message = Message(
        workspace_id=workspace_id,
        channel_id=channel_id,
        sender_id=user.id,
        parent_id=data.parent_id,
        content=data.content.strip(),
    )
    db.add(message)
    await db.flush()
    await db.refresh(message)

    # Automatically mark as read for sender
    await mark_channel_read(db, workspace_id, channel_id, user.id, message.id)

    return {
        "id": message.id,
        "workspace_id": message.workspace_id,
        "channel_id": message.channel_id,
        "sender_id": message.sender_id,
        "sender_name": user.name,
        "parent_id": message.parent_id,
        "content": message.content,
        "created_at": message.created_at,
        "reply_count": 0,
        "reactions": [],
    }


async def toggle_reaction(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    message_id: UUID,
    user_id: UUID,
    emoji: str,
) -> list[dict]:
    await get_channel(db, workspace_id, channel_id, user_id)

    # Verify message exists
    msg_res = await db.execute(
        select(Message)
        .options(selectinload(Message.reactions))
        .where(
            Message.id == message_id,
            Message.channel_id == channel_id,
            Message.workspace_id == workspace_id,
        )
    )
    message = msg_res.scalar_one_or_none()
    if not message:
        raise AuthError("Message not found", status_code=404)

    # Check if user already reacted with this emoji
    existing_reaction = await db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == message_id,
            MessageReaction.user_id == user_id,
            MessageReaction.emoji == emoji,
        )
    )
    reaction = existing_reaction.scalar_one_or_none()

    if reaction:
        await db.delete(reaction)
    else:
        new_reaction = MessageReaction(
            message_id=message_id,
            user_id=user_id,
            emoji=emoji,
        )
        db.add(new_reaction)

    await db.flush()

    # Re-fetch updated reactions
    refreshed = await db.execute(
        select(MessageReaction).where(MessageReaction.message_id == message_id)
    )
    all_reactions = list(refreshed.scalars().all())

    return build_reaction_summaries(all_reactions, user_id)


async def mark_channel_read(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    user_id: UUID,
    message_id: UUID | None = None,
) -> None:
    await _require_workspace_access(db, workspace_id, user_id)
    if message_id is None:
        latest = await db.execute(
            select(Message.id)
            .where(Message.channel_id == channel_id, Message.workspace_id == workspace_id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        message_id = latest.scalar_one_or_none()

    state_res = await db.execute(
        select(ChannelReadState).where(
            ChannelReadState.channel_id == channel_id,
            ChannelReadState.user_id == user_id,
        )
    )
    state = state_res.scalar_one_or_none()
    if state:
        state.last_read_message_id = message_id
    else:
        state = ChannelReadState(
            channel_id=channel_id,
            user_id=user_id,
            last_read_message_id=message_id,
        )
        db.add(state)
    await db.flush()


async def get_channel_unreads(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> list[dict]:
    await _require_workspace_access(db, workspace_id, user_id)
    channels = await list_channels(db, workspace_id, user_id)

    unreads = []
    for chan in channels:
        state_res = await db.execute(
            select(ChannelReadState).where(
                ChannelReadState.channel_id == chan.id,
                ChannelReadState.user_id == user_id,
            )
        )
        state = state_res.scalar_one_or_none()
        if not state or not state.last_read_message_id:
            # Count all messages in channel
            count_res = await db.execute(
                select(Message.id).where(Message.channel_id == chan.id)
            )
            count = len(count_res.scalars().all())
        else:
            # Count messages newer than last_read_message_id
            last_msg = await db.execute(
                select(Message).where(Message.id == state.last_read_message_id)
            )
            read_msg = last_msg.scalar_one_or_none()
            if read_msg:
                newer_res = await db.execute(
                    select(Message.id).where(
                        Message.channel_id == chan.id,
                        Message.created_at > read_msg.created_at,
                    )
                )
                count = len(newer_res.scalars().all())
            else:
                count = 0

        unreads.append({"channel_id": chan.id, "unread_count": count})

    return unreads


def format_message_dict(msg: Message, current_user_id: UUID) -> dict:
    sender_name = msg.sender.name if msg.sender else None
    reply_count = len(msg.replies) if msg.replies else 0
    reactions = build_reaction_summaries(msg.reactions or [], current_user_id)

    return {
        "id": msg.id,
        "workspace_id": msg.workspace_id,
        "channel_id": msg.channel_id,
        "sender_id": msg.sender_id,
        "sender_name": sender_name,
        "parent_id": msg.parent_id,
        "content": msg.content,
        "created_at": msg.created_at,
        "reply_count": reply_count,
        "reactions": reactions,
    }


def build_reaction_summaries(reactions: list[MessageReaction], current_user_id: UUID) -> list[dict]:
    emoji_map: dict[str, dict] = {}
    for r in reactions:
        if r.emoji not in emoji_map:
            emoji_map[r.emoji] = {
                "emoji": r.emoji,
                "count": 0,
                "user_ids": [],
                "has_reacted": False,
            }
        emoji_map[r.emoji]["count"] += 1
        emoji_map[r.emoji]["user_ids"].append(r.user_id)
        if r.user_id == current_user_id:
            emoji_map[r.emoji]["has_reacted"] = True

    return list(emoji_map.values())



async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
