import asyncio
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession

from app import database
from app.config import get_settings
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
# Meeting signaling moved to the per-meeting socket (targeted, not broadcast to the workspace).
RELAYED_WORKSPACE_EVENTS: set[str] = set()


async def _receive_json(websocket: WebSocket) -> dict | None:
    raw = await websocket.receive_text()
    if len(raw) > MAX_FRAME_BYTES:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


AUTH_TIMEOUT_CLOSE_CODE = 4408


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
        except asyncio.TimeoutError:
            # The auth frame didn't arrive in time (slow or interrupted network): the client may
            # retry. 1008 is kept for real authentication failures, which clients don't retry.
            await websocket.close(code=AUTH_TIMEOUT_CLOSE_CODE, reason="Authentication timed out")
            return None
        except WebSocketDisconnect:
            return None
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


MAX_MEETING_CHAT_CHARS = 2000


def _uuid_list(value) -> list[UUID]:
    """At most ten valid ids from a client-supplied list; anything malformed is dropped."""
    out = []
    for item in value if isinstance(value, list) else []:
        try:
            out.append(UUID(str(item)))
        except ValueError:
            continue
    return out[:10]
MEETING_IDLE_TIMEOUT_SECONDS = 90


@router.websocket("/workspaces/{workspace_id}/meetings/{meeting_id}")
async def meeting_websocket(websocket: WebSocket, workspace_id: UUID, meeting_id: UUID, token: str | None = Query(None)) -> None:
    """One connection per browser tab in a meeting: targeted signaling, media state, chat."""
    from app.routers.meetings import serialize_message
    from app.services import meeting_service
    from app.services.meeting_hub import FULL_CLOSE_CODE, RoomFull, meeting_hub

    user = await _authenticate(websocket, token)
    if not user:
        return
    try:
        async with database.AsyncSessionLocal() as db:
            meeting = await meeting_service.get_meeting(db, workspace_id, meeting_id, user.id)
            is_host = await meeting_service.prepare_join(db, meeting, user.id)
            await db.commit()
            meeting_info = await meeting_service.serialize(db, meeting, user.id)
    except AuthError as exc:
        await websocket.close(code=4404 if exc.status_code == 404 else 4410, reason=exc.message[:120])
        return

    try:
        client = await meeting_hub.join(meeting_id, websocket, user.id, user.name, is_host,
                                        limit=get_settings().max_meeting_participants, announce=False)
    except RoomFull as exc:
        await websocket.close(code=FULL_CLOSE_CODE, reason=str(exc)[:120])
        return
    room = meeting_hub.room(meeting_id)
    try:
        await websocket.send_json({
            "type": "welcome",
            "client_id": client.client_id,
            "participants": meeting_hub.participants(meeting_id),
            "screen_owner": room.screen_owner,
            "meeting": {**meeting_info, "participant_count": meeting_hub.connected_count(meeting_id)},
        })
        await meeting_hub.announce(meeting_id, client)
        while True:
            try:
                # Clients ping every 25 s; silence means a dead (half-open) connection, which
                # would otherwise stay in the room as a ghost participant.
                payload = await asyncio.wait_for(_receive_json(websocket), timeout=MEETING_IDLE_TIMEOUT_SECONDS)
            except asyncio.TimeoutError:
                await websocket.close(code=4408, reason="No activity")
                break
            if payload is None:
                continue
            kind = payload.get("type")
            if kind == "signal":
                target = str(payload.get("to") or "")
                if target and target != client.client_id:
                    try:
                        rate_limiter.check(f"meeting-signal:{client.client_id}", limit=400, window_seconds=10)
                    except HTTPException:
                        continue
                    await meeting_hub.send(meeting_id, target, {
                        "type": "signal", "from": client.client_id, "from_name": user.name,
                        "data": payload.get("data") if isinstance(payload.get("data"), dict) else {},
                    })
            elif kind == "state":
                await meeting_hub.set_state(meeting_id, client.client_id,
                                            **{k: payload[k] for k in ("mic", "cam", "hand") if k in payload})
            elif kind == "screen_share":
                accepted, owner = await meeting_hub.set_screen_share(meeting_id, client.client_id, bool(payload.get("active")))
                if not accepted:
                    owner_name = room.clients[owner].name if owner and owner in room.clients else "Someone"
                    await websocket.send_json({"type": "error", "code": "screen_busy",
                                               "detail": f"{owner_name} is already presenting."})
            elif kind == "chat":
                content = str(payload.get("content") or "").strip()[:MAX_MEETING_CHAT_CHARS]
                message_id = str(payload.get("client_message_id") or "")[:80]
                files = {key: _uuid_list(payload.get(key)) for key in ("attachment_ids", "shared_file_ids", "shared_document_ids")}
                if (not content and not any(files.values())) or len(message_id) < 8:
                    continue
                try:
                    rate_limiter.check(f"meeting-chat:{user.id}", limit=20, window_seconds=10)
                except HTTPException:
                    await websocket.send_json({"type": "error", "code": "rate_limited", "client_message_id": message_id,
                                               "detail": "You are sending messages too quickly. Wait a moment and retry."})
                    continue
                async with database.AsyncSessionLocal() as db:
                    try:
                        message, parent = await meeting_service.store_chat_message(
                            db, meeting_id, user, content, message_id, payload.get("reply_to_id"),
                            upload_ids=files["attachment_ids"], file_ids=files["shared_file_ids"],
                            document_ids=files["shared_document_ids"])
                    except AuthError as exc:  # e.g. a shared file the sender can't access
                        await websocket.send_json({"type": "error", "code": "chat_rejected",
                                                   "client_message_id": message_id, "detail": exc.message})
                        continue
                    await db.commit()
                    attached = await meeting_service.meeting_message_attachments(db, [message.id])
                    out = serialize_message(message, parent, attached.get(message.id, []))
                await meeting_hub.broadcast(meeting_id, {"type": "chat_message", "message": out})
            elif kind == "transcription":
                if not client.is_host:
                    await websocket.send_json({"type": "error", "code": "forbidden", "detail": "Only the host can change transcription."})
                    continue
                enabled = bool(payload.get("enabled"))
                async with database.AsyncSessionLocal() as db:
                    from app.models import Meeting

                    stored = await db.get(Meeting, meeting_id)
                    if stored is not None:
                        stored.transcription_enabled = enabled
                        await db.commit()
                await meeting_hub.broadcast(meeting_id, {"type": "transcription", "enabled": enabled, "by": user.name})
            elif kind == "ping":
                await websocket.send_json({"type": "pong"})
            elif kind == "leave":
                break
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Meeting websocket error: %s", exc)
    finally:
        await meeting_hub.leave(meeting_id, client.client_id)


@router.websocket("/notifications")
async def notifications_websocket(websocket: WebSocket, token: str | None = Query(None)) -> None:
    """Personal stream: new notifications are pushed as {"type": "notification", ...}."""
    from app.services import notification_service

    user = await _authenticate(websocket, token)
    if not user:
        return
    ws_manager.add_user(user.id, websocket)
    try:
        async with database.AsyncSessionLocal() as db:
            count = await notification_service.unread_count(db, user.id)
        await websocket.send_json({"type": "hello", "unread_count": count})
        while True:
            payload = await _receive_json(websocket)
            if payload and payload.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("Notification websocket error: %s", exc)
    finally:
        ws_manager.disconnect_user(user.id, websocket)
