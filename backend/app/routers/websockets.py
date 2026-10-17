import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.schemas.channel import MessageCreate, MessageResponse
from app.services.auth_service import AuthError, decode_access_token, get_user_by_id
from app.services.channel_service import get_channel, post_message
from app.services.websocket_manager import ws_manager
from app.services.workspace_service import get_workspace_membership

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websockets"])


async def authenticate_websocket(
    websocket: WebSocket,
    token: str | None,
    db: AsyncSession,
) -> User | None:
    """Validate JWT token passed in query parameter for WebSocket handshake."""
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Missing token")
        return None

    try:
        user_id = UUID(decode_access_token(token))
    except (AuthError, ValueError):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
        return None

    user = await get_user_by_id(db, user_id)
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="User not found")
        return None

    return user


@router.websocket("/workspaces/{workspace_id}/channels/{channel_id}")
async def channel_websocket(
    websocket: WebSocket,
    workspace_id: UUID,
    channel_id: UUID,
    token: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> None:
    user = await authenticate_websocket(websocket, token, db)
    if not user:
        return

    membership = await get_workspace_membership(db, workspace_id, user.id)
    if not membership:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Workspace access denied")
        return

    try:
        await get_channel(db, workspace_id, channel_id, user.id)
    except AuthError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Channel not found")
        return

    await ws_manager.connect_channel(channel_id, websocket)
    await websocket.send_json({"event": "connected", "channel_id": str(channel_id)})

    # Broadcast user joined
    await ws_manager.broadcast_to_channel(
        channel_id,
        {
            "event": "user_joined",
            "channel_id": str(channel_id),
            "user": {"id": str(user.id), "name": user.name},
        },
    )

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                payload = json.loads(raw_data)
            except json.JSONDecodeError:
                continue

            action = payload.get("action") or payload.get("type")

            if action == "message":
                content = (payload.get("content") or "").strip()
                if not content:
                    continue
                message = await post_message(
                    db,
                    workspace_id,
                    channel_id,
                    user,
                    MessageCreate(content=content),
                )
                await db.commit()
                msg_response = MessageResponse.model_validate(message).model_dump(mode="json")

                await ws_manager.broadcast_to_channel(
                    channel_id,
                    {"event": "new_message", "channel_id": str(channel_id), "data": msg_response},
                )
            elif action in ("typing_start", "typing_stop"):
                await ws_manager.broadcast_to_channel(
                    channel_id,
                    {
                        "event": action,
                        "channel_id": str(channel_id),
                        "user": {"id": str(user.id), "name": user.name},
                    },
                )
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Channel websocket error: %s", exc)
    finally:
        ws_manager.disconnect_channel(channel_id, websocket)
        await ws_manager.broadcast_to_channel(
            channel_id,
            {
                "event": "user_left",
                "channel_id": str(channel_id),
                "user": {"id": str(user.id), "name": user.name},
            },
        )


from app.dependencies import get_current_user


@router.get("/workspaces/{workspace_id}/presence")
async def get_presence(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    membership = await get_workspace_membership(db, workspace_id, current_user.id)
    if not membership:
        raise AuthError("Workspace access denied", status_code=403)
    return ws_manager.get_workspace_presence(workspace_id)


@router.websocket("/workspaces/{workspace_id}/events")
async def workspace_events_websocket(
    websocket: WebSocket,
    workspace_id: UUID,
    token: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> None:
    user = await authenticate_websocket(websocket, token, db)
    if not user:
        return

    membership = await get_workspace_membership(db, workspace_id, user.id)
    if not membership:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Workspace access denied")
        return

    await ws_manager.connect_workspace(workspace_id, websocket)
    ws_manager.set_presence(workspace_id, user.id, user.name, "online")
    await websocket.send_json({"event": "connected", "workspace_id": str(workspace_id)})

    # Broadcast presence
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {
            "event": "presence_update",
            "workspace_id": str(workspace_id),
            "user": {"user_id": str(user.id), "name": user.name, "status": "online"},
        },
    )

    try:
        while True:
            raw_data = await websocket.receive_text()
            try:
                payload = json.loads(raw_data)
            except json.JSONDecodeError:
                continue

            event_type = payload.get("event") or payload.get("type")
            if event_type == "presence_update":
                new_status = payload.get("status", "online")
                ws_manager.set_presence(workspace_id, user.id, user.name, new_status)
                await ws_manager.broadcast_to_workspace(
                    workspace_id,
                    {
                        "event": "presence_update",
                        "workspace_id": str(workspace_id),
                        "user": {"user_id": str(user.id), "name": user.name, "status": new_status},
                    },
                )
            elif event_type in (
                "video_signal_offer",
                "video_signal_answer",
                "video_signal_ice_candidate",
                "video_signal_join",
                "video_signal_ready",
                "transcript_broadcast",
                "action_item_broadcast",
            ):
                payload["sender_id"] = str(user.id)
                payload["sender_name"] = user.name
                await ws_manager.broadcast_to_workspace(workspace_id, payload)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Workspace events websocket error: %s", exc)
    finally:
        ws_manager.remove_presence(workspace_id, user.id)
        ws_manager.disconnect_workspace(workspace_id, websocket)
        await ws_manager.broadcast_to_workspace(
            workspace_id,
            {
                "event": "presence_update",
                "workspace_id": str(workspace_id),
                "user": {"user_id": str(user.id), "name": user.name, "status": "offline"},
            },
        )



