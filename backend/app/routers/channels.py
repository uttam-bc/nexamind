from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import Message, MessageAttachment, User
from app.security import check_identity_limit
from app.services import attachment_service, storage
from app.services.auth_service import AuthError
from app.services.upload_utils import safe_content_type
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




# --- attachments -----------------------------------------------------------------------------

@router.post("/{channel_id}/attachments", status_code=status.HTTP_201_CREATED)
async def upload_channel_attachment(
    workspace_id: UUID,
    channel_id: UUID,
    file: UploadFile = File(...),
    client_upload_id: str | None = Form(None, min_length=8, max_length=80),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    """Upload one file to send in this conversation; send the message with its id afterwards.
    Retrying with the same `client_upload_id` returns the stored file instead of a copy."""
    channel = await get_channel(db, workspace_id, channel_id, current_user.id)
    check_identity_limit("chat-upload", str(current_user.id), 60, 60)
    record = await attachment_service.store_upload(
        db, workspace_id=channel.workspace_id, user=current_user, upload=file,
        client_upload_id=client_upload_id, channel_id=channel.id,
    )
    return {"id": str(record.id), "filename": record.filename, "size": record.file_size, "mime_type": record.mime_type}


@router.get("/{channel_id}/attachments/{attachment_id}/download")
async def download_channel_attachment(
    workspace_id: UUID,
    channel_id: UUID,
    attachment_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
):
    """The original file. Readers of the conversation only; shared library files also need access
    to their workspace. Always served as a download (never rendered in our origin)."""
    channel = await get_channel(db, workspace_id, channel_id, current_user.id)
    attachment = (await db.execute(
        select(MessageAttachment).join(Message, MessageAttachment.message_id == Message.id).where(
            MessageAttachment.id == attachment_id, Message.channel_id == channel.id)
    )).scalar_one_or_none()
    if attachment is None:
        raise AuthError("Attachment not found", status_code=404)
    record = await attachment_service.file_for_viewer(db, attachment, current_user)
    return storage.download_response(record.file_path, record.filename, safe_content_type(record.mime_type))


# --- Calls from direct messages ---------------------------------------------------------------

class CallStart(BaseModel):
    client_request_id: str | None = Field(default=None, min_length=8, max_length=64)


@router.get("/{channel_id}/call")
async def get_live_call(
    workspace_id: UUID,
    channel_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    """The call running in this conversation, if any (shown as "Join call")."""
    from app.services import channel_service, meeting_service

    channel = await channel_service.get_channel(db, workspace_id, channel_id, current_user.id)
    meeting = await meeting_service.live_call(db, channel.id)
    return {"call": await meeting_service.serialize(db, meeting, current_user.id) if meeting else None}


@router.post("/{channel_id}/call")
async def start_call(
    workspace_id: UUID,
    channel_id: UUID,
    data: CallStart,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    """Start a video call from a direct message (or join the one already running) and ring the others."""
    from app.services import meeting_service

    check_identity_limit("call", str(current_user.id), 20, 60)
    meeting, created = await meeting_service.start_call(db, workspace_id, channel_id, current_user, data.client_request_id)
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return {"call": await meeting_service.serialize(db, meeting, current_user.id), "created": created}
