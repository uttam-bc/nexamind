from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.channel import (
    ChannelCreate,
    ChannelResponse,
    MessageCreate,
    MessageResponse,
)
from app.services.channel_service import (
    create_channel,
    get_channel,
    list_channels,
    list_messages,
    post_message,
)
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/workspaces/{workspace_id}/channels", tags=["channels"])


@router.get("", response_model=list[ChannelResponse])
async def get_workspace_channels(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ChannelResponse]:
    channels = await list_channels(db, workspace_id, current_user.id)
    return [ChannelResponse.model_validate(c) for c in channels]


@router.post("", response_model=ChannelResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace_channel(
    workspace_id: UUID,
    data: ChannelCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChannelResponse:
    channel = await create_channel(db, workspace_id, current_user, data)
    channel_data = ChannelResponse.model_validate(channel).model_dump(mode="json")
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "channel_created", "workspace_id": str(workspace_id), "data": channel_data},
    )
    return ChannelResponse.model_validate(channel)


@router.get("/{channel_id}", response_model=ChannelResponse)
async def get_workspace_channel(
    workspace_id: UUID,
    channel_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChannelResponse:
    channel = await get_channel(db, workspace_id, channel_id, current_user.id)
    return ChannelResponse.model_validate(channel)


@router.get("/{channel_id}/messages", response_model=list[MessageResponse])
async def get_channel_messages(
    workspace_id: UUID,
    channel_id: UUID,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MessageResponse]:
    messages = await list_messages(db, workspace_id, channel_id, current_user.id, limit=limit)
    return [MessageResponse.model_validate(m) for m in messages]


@router.post("/{channel_id}/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def post_channel_message(
    workspace_id: UUID,
    channel_id: UUID,
    data: MessageCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
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

