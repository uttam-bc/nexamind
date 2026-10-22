import asyncio
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import database
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.channel import MessageCreate, MessageResponse
from app.security import rate_limiter
from app.services.auth_service import AuthError, get_user_for_token
from app.services.channel_service import get_channel, post_message
from app.services.websocket_manager import ws_manager
from app.services.workspace_service import get_workspace_membership

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ws", tags=["websockets"])

AUTH_TIMEOUT_SECONDS = 10
MAX_FRAME_BYTES = 64 * 1024
MAX_CHAT_MESSAGE_CHARS = 10_000
PRESENCE_STATUSES = {"online", "away", "busy", "offline"}
RELAYED_WORKSPACE_EVENTS = {
    "video_signal_offer",
    "video_signal_answer",
    "video_signal_ice_candidate",
    "video_signal_join",
    "video_signal_ready",
    "transcript_broadcast",
    "action_item_broadcast",
}


async def _receive_json(websocket: WebSocket) -> dict | None:
    raw = await websocket.receive_text()
    if len(raw) > MAX_FRAME_BYTES:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


async def _authenticate(websocket: WebSocket, query_token: str | None) -> User | None:
    """Accept the socket, then authenticate.

    Browsers send `{"type": "auth", "token": "..."}` as the first frame so the JWT never appears
    in URLs or access logs. A `?token=` query parameter is still accepted for older clients.
    """
    await websocket.accept()
    token = query_token
    if not token:
        try:
            first = await asyncio.wait_for(_receive_json(websocket), timeout=AUTH_TIMEOUT_SECONDS)
        except (asyncio.TimeoutError, WebSocketDisconnect):
            first = None
        if first and first.get("type") == "auth":
            token = first.get("token")
    if not token or not isinstance(token, str):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Authentication required")
        return None

    try:
        async with database.AsyncSessionLocal() as db:
            user = await get_user_for_token(db, token)
    except AuthError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")
        return None
    return user


@router.websocket("/workspaces/{workspace_id}/channels/{channel_id}")
async def channel_websocket(
    websocket: WebSocket,
    workspace_id: UUID,
    channel_id: UUID,
    token: str | None = Query(None),
) -> None:
    user = await _authenticate(websocket, token)
    if not user:
        return

    try:
        async with database.AsyncSessionLocal() as db:
            await get_channel(db, workspace_id, channel_id, user.id)
    except AuthError:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Channel not found")
        return

    ws_manager.add_channel(channel_id, websocket)
    user_info = {"id": str(user.id), "name": user.name}
    try:
        await websocket.send_json({"event": "connected", "channel_id": str(channel_id)})
        await ws_manager.broadcast_to_channel(
            channel_id, {"event": "user_joined", "channel_id": str(channel_id), "user": user_info}
        )
        while True:
            payload = await _receive_json(websocket)
            if payload is None:
                continue
            action = payload.get("action") or payload.get("type")

            if action == "message":
                content = str(payload.get("content") or "").strip()[:MAX_CHAT_MESSAGE_CHARS]
                if not content:
                    continue
                try:
                    rate_limiter.check(f"ws-msg:{user.id}", limit=30, window_seconds=10)
                except HTTPException:
                    await websocket.send_json({"event": "error", "detail": "You are sending messages too quickly."})
                    continue
                try:
                    async with database.AsyncSessionLocal() as db:
                        # Re-checks access on every message, so removed members stop immediately.
                        message = await post_message(db, workspace_id, channel_id, user, MessageCreate(content=content))
                        await db.commit()
                except AuthError:
                    await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Access revoked")
                    return
                msg_response = MessageResponse.model_validate(message).model_dump(mode="json")
                await ws_manager.broadcast_to_channel(
                    channel_id, {"event": "new_message", "channel_id": str(channel_id), "data": msg_response}
                )
            elif action in ("typing_start", "typing_stop"):
                await ws_manager.broadcast_to_channel(
                    channel_id, {"event": action, "channel_id": str(channel_id), "user": user_info}
                )
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Channel websocket error: %s", exc)
    finally:
        ws_manager.disconnect_channel(channel_id, websocket)
        await ws_manager.broadcast_to_channel(
            channel_id, {"event": "user_left", "channel_id": str(channel_id), "user": user_info}
        )


@router.get("/workspaces/{workspace_id}/presence")
async def get_presence(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[dict]:
    membership = await get_workspace_membership(db, workspace_id, current_user.id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
    return await ws_manager.get_workspace_presence(workspace_id)


@router.websocket("/workspaces/{workspace_id}/events")
async def workspace_events_websocket(
    websocket: WebSocket,
    workspace_id: UUID,
    token: str | None = Query(None),
) -> None:
    user = await _authenticate(websocket, token)
    if not user:
        return

    async with database.AsyncSessionLocal() as db:
        membership = await get_workspace_membership(db, workspace_id, user.id)
    if not membership:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Workspace access denied")
        return

    ws_manager.add_workspace(workspace_id, websocket)

    async def announce(new_status: str) -> None:
        await ws_manager.broadcast_to_workspace(
            workspace_id,
            {
                "event": "presence_update",
                "workspace_id": str(workspace_id),
                "user": {"user_id": str(user.id), "name": user.name, "status": new_status},
            },
        )

    try:
        await ws_manager.set_presence(workspace_id, user.id, user.name, "online")
        await websocket.send_json({"event": "connected", "workspace_id": str(workspace_id)})
        await announce("online")

        while True:
            payload = await _receive_json(websocket)
            if payload is None:
                continue
            event_type = payload.get("event") or payload.get("type")
            if event_type == "presence_update":
                new_status = payload.get("status")
                if new_status not in PRESENCE_STATUSES:
                    continue
                await ws_manager.set_presence(workspace_id, user.id, user.name, new_status)
                await announce(new_status)
            elif event_type in RELAYED_WORKSPACE_EVENTS:
                try:
                    rate_limiter.check(f"ws-signal:{user.id}", limit=200, window_seconds=10)
                except HTTPException:
                    continue
                # Sender identity always comes from the authenticated user, never the client.
                payload["sender_id"] = str(user.id)
                payload["sender_name"] = user.name
                payload["workspace_id"] = str(workspace_id)
                await ws_manager.broadcast_to_workspace(workspace_id, payload)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Workspace events websocket error: %s", exc)
    finally:
        ws_manager.disconnect_workspace(workspace_id, websocket)
        await ws_manager.remove_presence(workspace_id, user.id)
        await announce("offline")
