import re
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import (
    AiMemory,
    Channel,
    ChannelMember,
    ChannelReadState,
    Message,
    MessageReaction,
    User,
    Workspace,
    WorkspaceType,
)
from app.schemas.channel import ChannelCreate, MessageCreate
from app.services.auth_service import AuthError, get_user_by_username
from app.services.workspace_service import MANAGER_ROLES, get_workspace_membership

# Access rules
# - Public channel: any member of the channel's workspace.
# - Private channel: members of the channel's workspace who are also listed in channel_members.
# - Direct message: only the users listed in channel_members, regardless of workspace membership,
#   so starting a DM never grants anyone access to the workspace itself.


async def _is_channel_member(db: AsyncSession, channel_id: UUID, user_id: UUID) -> bool:
    result = await db.execute(
        select(ChannelMember.id).where(ChannelMember.channel_id == channel_id, ChannelMember.user_id == user_id)
    )
    return result.first() is not None


async def list_channels(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> list[Channel]:
    await _require_workspace_access(db, workspace_id, user_id)

    member_channel_ids = select(ChannelMember.channel_id).where(ChannelMember.user_id == user_id)
    visible_here = and_(
        Channel.workspace_id == workspace_id,
        or_(Channel.is_private.is_(False), Channel.id.in_(member_channel_ids)),
    )
    conditions = [visible_here]

    # A user's DMs live in whichever workspace they were started from; show them all in the
    # user's personal workspace so both participants can find the conversation.
    workspace = await db.get(Workspace, workspace_id)
    if workspace is not None and workspace.type == WorkspaceType.PERSONAL:
        conditions.append(and_(Channel.is_direct.is_(True), Channel.id.in_(member_channel_ids)))

    result = await db.execute(select(Channel).where(or_(*conditions)).order_by(Channel.created_at.asc()))
    channels = list(result.scalars().unique().all())

    has_public_channel = await db.execute(
        select(Channel.id).where(Channel.workspace_id == workspace_id, Channel.is_private.is_(False)).limit(1)
    )
    if has_public_channel.first() is None:
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
        channels.insert(0, default_channel)

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
        name=data.name.strip(),
        description=data.description,
        is_private=data.is_private,
        created_by=user.id,
    )
    db.add(channel)
    await db.flush()
    if channel.is_private:
        db.add(ChannelMember(channel_id=channel.id, user_id=user.id))
        await db.flush()
    await db.refresh(channel)
    return channel


async def add_channel_member(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    current_user: User,
    target_username: str,
) -> Channel:
    """Invite a workspace member into a private channel the requester belongs to."""
    channel = await get_channel(db, workspace_id, channel_id, current_user.id)
    if not channel.is_private or channel.is_direct:
        raise AuthError("Members can only be added to private channels", status_code=400)
    target = await get_user_by_username(db, target_username)
    if not target or not await get_workspace_membership(db, channel.workspace_id, target.id):
        raise AuthError("That user is not a member of this workspace", status_code=404)
    if not await _is_channel_member(db, channel.id, target.id):
        db.add(ChannelMember(channel_id=channel.id, user_id=target.id))
        await db.flush()
    return channel


async def create_or_get_dm_channel(
    db: AsyncSession,
    workspace_id: UUID,
    current_user: User,
    target_username: str,
) -> Channel:
    await _require_workspace_access(db, workspace_id, current_user.id)
    target_user = await get_user_by_username(db, target_username)
    if not target_user:
        raise AuthError(f"User @{target_username.lstrip('@')} not found", status_code=404)

    participant_ids = {current_user.id, target_user.id}

    # Reuse an existing conversation between exactly these participants, wherever it was started.
    candidate_ids = (
        select(ChannelMember.channel_id)
        .join(Channel, Channel.id == ChannelMember.channel_id)
        .where(Channel.is_direct.is_(True))
        .group_by(ChannelMember.channel_id)
        .having(func.count(ChannelMember.id) == len(participant_ids))
    )
    for user_id in participant_ids:
        candidate_ids = candidate_ids.where(
            ChannelMember.channel_id.in_(select(ChannelMember.channel_id).where(ChannelMember.user_id == user_id))
        )
    existing = (
        await db.execute(select(Channel).where(Channel.id.in_(candidate_ids)).order_by(Channel.created_at.asc()))
    ).scalars().first()
    if existing:
        return existing

    me = current_user.username or str(current_user.id)[:8]
    if target_user.id == current_user.id:
        name = f"dm-{me}-notes"
        description = f"Personal notes and saved messages for @{me}"
    else:
        other = target_user.username or str(target_user.id)[:8]
        u1, u2 = sorted([me, other])
        name = f"dm-{u1}-{u2}"
        description = f"Direct message between @{me} and @{other}"

    dm_channel = Channel(
        workspace_id=workspace_id,
        name=name,
        description=description,
        is_private=True,
        is_direct=True,
        created_by=current_user.id,
    )
    db.add(dm_channel)
    await db.flush()
    for user_id in participant_ids:
        db.add(ChannelMember(channel_id=dm_channel.id, user_id=user_id))
    await db.flush()
    await db.refresh(dm_channel)
    return dm_channel


async def get_channel(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    user_id: UUID,
) -> Channel:
    """Load a channel the user may read. `workspace_id` is the workspace in the request path."""
    channel = await db.get(Channel, channel_id)
    if channel is None:
        raise AuthError("Channel not found", status_code=404)

    if channel.is_direct:
        if await _is_channel_member(db, channel.id, user_id):
            return channel
        raise AuthError("Channel not found", status_code=404)

    if channel.workspace_id != workspace_id:
        raise AuthError("Channel not found", status_code=404)
    await _require_workspace_access(db, workspace_id, user_id)
    if channel.is_private and not await _is_channel_member(db, channel.id, user_id):
        raise AuthError("Channel not found", status_code=404)
    return channel


async def list_messages(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    user_id: UUID,
    parent_id: UUID | None = None,
    root_only: bool = False,
    limit: int = 100,
    before: datetime | None = None,
) -> list[dict]:
    channel = await get_channel(db, workspace_id, channel_id, user_id)
    query = (
        select(Message)
        .options(
            selectinload(Message.sender),
            selectinload(Message.reactions),
            selectinload(Message.replies),
        )
        .where(Message.channel_id == channel.id)
    )

    if parent_id is not None:
        query = query.where(Message.parent_id == parent_id)
    elif root_only:
        query = query.where(Message.parent_id.is_(None))
    if before is not None:
        # Cursor pagination: pass the oldest loaded message's created_at to get the page before it.
        query = query.where(Message.created_at < before)

    # Newest `limit` messages, returned oldest first.
    query = query.order_by(Message.created_at.desc()).limit(limit)
    result = await db.execute(query)
    messages = list(reversed(result.scalars().all()))

    return [format_message_dict(msg, user_id) for msg in messages]


async def post_message(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    user: User,
    data: MessageCreate,
) -> dict:
    channel = await get_channel(db, workspace_id, channel_id, user.id)

    if data.parent_id:
        parent_result = await db.execute(
            select(Message).where(Message.id == data.parent_id, Message.channel_id == channel.id)
        )
        if parent_result.scalar_one_or_none() is None:
            raise AuthError("Parent message not found in this channel", status_code=404)

    message = Message(
        workspace_id=channel.workspace_id,
        channel_id=channel.id,
        sender_id=user.id,
        parent_id=data.parent_id,
        content=data.content.strip(),
    )
    db.add(message)
    await db.flush()
    await db.refresh(message)

    await _set_read_state(db, channel.id, user.id, message.id)
    await _notify_message(db, channel, message, user)

    return {
        "id": message.id,
        "workspace_id": message.workspace_id,
        "channel_id": message.channel_id,
        "sender_id": message.sender_id,
        "sender_name": user.name,
        "sender_username": user.username,
        "parent_id": message.parent_id,
        "content": message.content,
        "created_at": message.created_at,
        "reply_count": 0,
        "reactions": [],
    }


async def _get_message(db: AsyncSession, channel: Channel, message_id: UUID) -> Message:
    result = await db.execute(
        select(Message)
        .options(selectinload(Message.sender), selectinload(Message.reactions), selectinload(Message.replies))
        .where(Message.id == message_id, Message.channel_id == channel.id)
    )
    message = result.scalar_one_or_none()
    if message is None:
        raise AuthError("Message not found", status_code=404)
    return message


async def _forget_message(db: AsyncSession, message: Message) -> None:
    """Drop memories distilled from a message once it is edited or deleted."""
    await db.execute(delete(AiMemory).where(AiMemory.source_type == "chat", AiMemory.source_id == str(message.id)))


async def edit_message(
    db: AsyncSession, workspace_id: UUID, channel_id: UUID, message_id: UUID, user_id: UUID, content: str
) -> dict:
    channel = await get_channel(db, workspace_id, channel_id, user_id)
    message = await _get_message(db, channel, message_id)
    if message.sender_id != user_id:
        raise AuthError("You can only edit your own messages", status_code=403)
    message.content = content.strip()
    message.edited_at = datetime.now(UTC)
    await _forget_message(db, message)
    await db.flush()
    return format_message_dict(message, user_id)


async def delete_message(db: AsyncSession, workspace_id: UUID, channel_id: UUID, message_id: UUID, user_id: UUID) -> None:
    """Senders may delete their messages; workspace owners/admins may moderate non-DM channels."""
    channel = await get_channel(db, workspace_id, channel_id, user_id)
    message = await _get_message(db, channel, message_id)
    if message.sender_id != user_id:
        membership = None if channel.is_direct else await get_workspace_membership(db, channel.workspace_id, user_id)
        if not membership or membership.role not in MANAGER_ROLES:
            raise AuthError("You can only delete your own messages", status_code=403)
    await _forget_message(db, message)
    for reply in message.replies or []:
        await _forget_message(db, reply)
    await db.delete(message)
    await db.flush()


async def delete_channel(db: AsyncSession, workspace_id: UUID, channel_id: UUID, user_id: UUID) -> None:
    """Channel creators and workspace owners/admins may delete a channel and its history."""
    channel = await get_channel(db, workspace_id, channel_id, user_id)
    if channel.is_direct:
        raise AuthError("Direct conversations can't be deleted", status_code=400)
    if channel.created_by != user_id:
        membership = await get_workspace_membership(db, channel.workspace_id, user_id)
        if not membership or membership.role not in MANAGER_ROLES:
            raise AuthError("Only the channel's creator or a workspace admin can delete it", status_code=403)
    message_ids = [str(mid) for mid in (await db.execute(select(Message.id).where(Message.channel_id == channel.id))).scalars()]
    if message_ids:
        await db.execute(delete(AiMemory).where(AiMemory.source_type == "chat", AiMemory.source_id.in_(message_ids)))
    await db.delete(channel)
    await db.flush()


MENTION = re.compile(r"(?<![\w@])@([a-z0-9_\-]{2,50})", re.IGNORECASE)


async def _can_read(db: AsyncSession, channel: Channel, user_id: UUID) -> bool:
    if channel.is_direct or channel.is_private:
        return await _is_channel_member(db, channel.id, user_id)
    return bool(await get_workspace_membership(db, channel.workspace_id, user_id))


async def _notify_message(db: AsyncSession, channel: Channel, message: Message, sender: User) -> None:
    """Direct messages notify the other participants; @mentions notify people who can read the channel."""
    from app.services import notification_service

    workspace = await db.get(Workspace, channel.workspace_id)
    tab = "solo_chat" if workspace and workspace.type == WorkspaceType.PERSONAL else "channels"
    link = {"tab": tab, "workspace_id": str(channel.workspace_id), "channel_id": str(channel.id),
            "message_id": str(message.id)}
    preview = message.content[:140]
    if channel.is_direct:
        others = (await db.execute(select(ChannelMember.user_id).where(
            ChannelMember.channel_id == channel.id, ChannelMember.user_id != sender.id))).scalars().all()
        await notification_service.notify_many(
            db, others, kind="direct_message", category="messages", workspace_id=channel.workspace_id,
            title=f"New message from {sender.name}", body=preview, link=link,
            dedupe_key=f"message:{message.id}", actor_id=sender.id,
        )
        return
    for username in {m.lower() for m in MENTION.findall(message.content)}:
        mentioned = await get_user_by_username(db, username)
        if mentioned is None or mentioned.id == sender.id or not await _can_read(db, channel, mentioned.id):
            continue
        await notification_service.notify(
            db, mentioned.id, kind="mention", category="messages", workspace_id=channel.workspace_id,
            title=f"{sender.name} mentioned you in #{channel.name}", body=preview, link=link,
            dedupe_key=f"mention:{message.id}", actor_id=sender.id,
        )


async def toggle_reaction(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    message_id: UUID,
    user_id: UUID,
    emoji: str,
) -> list[dict]:
    channel = await get_channel(db, workspace_id, channel_id, user_id)

    msg_res = await db.execute(
        select(Message.id).where(Message.id == message_id, Message.channel_id == channel.id)
    )
    if msg_res.first() is None:
        raise AuthError("Message not found", status_code=404)

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
        db.add(MessageReaction(message_id=message_id, user_id=user_id, emoji=emoji))
    await db.flush()

    refreshed = await db.execute(select(MessageReaction).where(MessageReaction.message_id == message_id))
    return build_reaction_summaries(list(refreshed.scalars().all()), user_id)


async def mark_channel_read(
    db: AsyncSession,
    workspace_id: UUID,
    channel_id: UUID,
    user_id: UUID,
    message_id: UUID | None = None,
) -> None:
    channel = await get_channel(db, workspace_id, channel_id, user_id)
    if message_id is None:
        latest = await db.execute(
            select(Message.id)
            .where(Message.channel_id == channel.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        message_id = latest.scalar_one_or_none()
    await _set_read_state(db, channel.id, user_id, message_id)


async def _set_read_state(db: AsyncSession, channel_id: UUID, user_id: UUID, message_id: UUID | None) -> None:
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
        db.add(ChannelReadState(channel_id=channel_id, user_id=user_id, last_read_message_id=message_id))
    await db.flush()


async def get_channel_unreads(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> list[dict]:
    channels = await list_channels(db, workspace_id, user_id)
    if not channels:
        return []
    channel_ids = [c.id for c in channels]

    read_states = {
        s.channel_id: s.last_read_message_id
        for s in (
            await db.execute(
                select(ChannelReadState).where(
                    ChannelReadState.user_id == user_id,
                    ChannelReadState.channel_id.in_(channel_ids),
                )
            )
        ).scalars()
    }
    read_ids = [mid for mid in read_states.values() if mid]
    read_times = {}
    if read_ids:
        read_times = dict((await db.execute(select(Message.id, Message.created_at).where(Message.id.in_(read_ids)))).all())

    unreads = []
    for channel_id in channel_ids:
        query = select(func.count(Message.id)).where(Message.channel_id == channel_id)
        last_read_id = read_states.get(channel_id)
        if last_read_id:
            read_at = read_times.get(last_read_id)
            if read_at is None:
                unreads.append({"channel_id": channel_id, "unread_count": 0})
                continue
            query = query.where(Message.created_at > read_at)
        count = (await db.execute(query)).scalar() or 0
        unreads.append({"channel_id": channel_id, "unread_count": count})
    return unreads


def format_message_dict(msg: Message, current_user_id: UUID) -> dict:
    return {
        "id": msg.id,
        "workspace_id": msg.workspace_id,
        "channel_id": msg.channel_id,
        "sender_id": msg.sender_id,
        "sender_name": msg.sender.name if msg.sender else None,
        "sender_username": msg.sender.username if msg.sender else None,
        "parent_id": msg.parent_id,
        "content": msg.content,
        "created_at": msg.created_at,
        "edited_at": msg.edited_at,
        "reply_count": len(msg.replies) if msg.replies else 0,
        "reactions": build_reaction_summaries(msg.reactions or [], current_user_id),
    }


def build_reaction_summaries(reactions: list[MessageReaction], current_user_id: UUID) -> list[dict]:
    emoji_map: dict[str, dict] = {}
    for r in reactions:
        entry = emoji_map.setdefault(r.emoji, {"emoji": r.emoji, "count": 0, "user_ids": [], "has_reacted": False})
        entry["count"] += 1
        entry["user_ids"].append(r.user_id)
        if r.user_id == current_user_id:
            entry["has_reacted"] = True
    return list(emoji_map.values())


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
