from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.channel import (
    ChannelCreate,
    ChannelResponse,
    ChannelUnreadSummary,
    MessageCreate,
    MessageEdit,
    MessageResponse,
    ReactionSummary,
    ReactionToggleRequest,
)
from app.services.channel_service import (
    add_channel_member,
    create_channel,
    create_or_get_dm_channel,
    delete_channel,
    delete_message,
    edit_message,
    get_channel,
    get_channel_unreads,
    list_channels,
    list_messages,
    mark_channel_read,
    post_message,
    toggle_reaction,
)
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/workspaces/{workspace_id}/channels", tags=["channels"])


@router.get("", response_model=list[ChannelResponse])
async def get_workspace_channels(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[ChannelResponse]:
    channels = await list_channels(db, workspace_id, current_user.id)
    return [ChannelResponse.model_validate(c) for c in channels]


@router.get("/unread", response_model=list[ChannelUnreadSummary])
async def get_unread_channels(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[ChannelUnreadSummary]:
    unreads = await get_channel_unreads(db, workspace_id, current_user.id)
    return [ChannelUnreadSummary.model_validate(u) for u in unreads]


@router.post("", response_model=ChannelResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace_channel(
    workspace_id: UUID,
    data: ChannelCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> ChannelResponse:
    channel = await create_channel(db, workspace_id, current_user, data)
    if not channel.is_private:
        channel_data = ChannelResponse.model_validate(channel).model_dump(mode="json")
        await ws_manager.broadcast_to_workspace(
            workspace_id,
            {"event": "channel_created", "workspace_id": str(workspace_id), "data": channel_data},
        )
    return ChannelResponse.model_validate(channel)


class CreateDmRequest(BaseModel):
    target_username: str = Field(..., min_length=2, max_length=50)


@router.post("/dm", response_model=ChannelResponse, status_code=status.HTTP_201_CREATED)
async def create_or_open_dm(
    workspace_id: UUID,
    data: CreateDmRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> ChannelResponse:
    channel = await create_or_get_dm_channel(db, workspace_id, current_user, data.target_username)
    return ChannelResponse.model_validate(channel)


@router.post("/{channel_id}/members", response_model=ChannelResponse)
async def add_private_channel_member(
    workspace_id: UUID,
    channel_id: UUID,
    data: CreateDmRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> ChannelResponse:
    channel = await add_channel_member(db, workspace_id, channel_id, current_user, data.target_username)
    return ChannelResponse.model_validate(channel)


@router.get("/{channel_id}", response_model=ChannelResponse)
async def get_workspace_channel(
    workspace_id: UUID,
    channel_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> ChannelResponse:
    channel = await get_channel(db, workspace_id, channel_id, current_user.id)
    return ChannelResponse.model_validate(channel)


@router.get("/{channel_id}/messages", response_model=list[MessageResponse])
async def get_channel_messages(
    workspace_id: UUID,
    channel_id: UUID,
    parent_id: UUID | None = None,
    root_only: bool = False,
    limit: int = Query(100, ge=1, le=500),
    before: datetime | None = Query(None, description="Return messages older than this timestamp"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[MessageResponse]:
    messages = await list_messages(
        db,
        workspace_id,
        channel_id,
        current_user.id,
        parent_id=parent_id,
        root_only=root_only,
        limit=limit,
        before=before,
    )
    return [MessageResponse.model_validate(m) for m in messages]


@router.post("/{channel_id}/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def post_channel_message(
    workspace_id: UUID,
    channel_id: UUID,
    data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> MessageResponse:
    message = await post_message(db, workspace_id, channel_id, current_user, data)
    msg_response = MessageResponse.model_validate(message)
    await ws_manager.broadcast_to_channel(
        channel_id,
        {
            "event": "new_message",
            "channel_id": str(channel_id),
            "data": msg_response.model_dump(mode="json"),
        },
    )
    return msg_response


@router.patch("/{channel_id}/messages/{message_id}", response_model=MessageResponse)
async def edit_channel_message(
    workspace_id: UUID,
    channel_id: UUID,
    message_id: UUID,
    data: MessageEdit,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> MessageResponse:
    message = MessageResponse.model_validate(
        await edit_message(db, workspace_id, channel_id, message_id, current_user.id, data.content)
    )
    await ws_manager.broadcast_to_channel(
        channel_id,
        {"event": "message_edited", "channel_id": str(channel_id), "data": message.model_dump(mode="json")},
    )
    return message


@router.delete("/{channel_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_channel_message(
    workspace_id: UUID,
    channel_id: UUID,
    message_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> Response:
    await delete_message(db, workspace_id, channel_id, message_id, current_user.id)
    await ws_manager.broadcast_to_channel(
        channel_id,
        {"event": "message_deleted", "channel_id": str(channel_id), "message_id": str(message_id)},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_channel(
    workspace_id: UUID,
    channel_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> Response:
    await delete_channel(db, workspace_id, channel_id, current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{channel_id}/messages/{message_id}/reactions", response_model=list[ReactionSummary])
async def react_to_message(
    workspace_id: UUID,
    channel_id: UUID,
    message_id: UUID,
    data: ReactionToggleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[ReactionSummary]:
    reactions = await toggle_reaction(
        db, workspace_id, channel_id, message_id, current_user.id, data.emoji
    )
    res = [ReactionSummary.model_validate(r) for r in reactions]
    await ws_manager.broadcast_to_channel(
        channel_id,
        {
            "event": "reaction_updated",
            "channel_id": str(channel_id),
            "message_id": str(message_id),
            "data": [r.model_dump(mode="json") for r in res],
        },
    )
    return res


@router.post("/{channel_id}/read", status_code=status.HTTP_200_OK)
async def mark_channel_as_read(
    workspace_id: UUID,
    channel_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    await mark_channel_read(db, workspace_id, channel_id, current_user.id)
    return {"status": "ok"}


