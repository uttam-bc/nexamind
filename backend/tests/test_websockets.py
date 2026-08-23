import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient

from app.models import User
from app.routers.websockets import authenticate_websocket, channel_websocket, workspace_events_websocket
from app.services.websocket_manager import ConnectionManager, ws_manager


@pytest.mark.asyncio
async def test_connection_manager_channel_and_workspace_broadcast() -> None:
    manager = ConnectionManager()
    channel_a = uuid.uuid4()
    channel_b = uuid.uuid4()
    workspace_id = uuid.uuid4()

    ws_a1 = AsyncMock()
    ws_a2 = AsyncMock()
    ws_b1 = AsyncMock()
    ws_workspace = AsyncMock()

    # Connect clients
    await manager.connect_channel(channel_a, ws_a1)
    await manager.connect_channel(channel_a, ws_a2)
    await manager.connect_channel(channel_b, ws_b1)
    await manager.connect_workspace(workspace_id, ws_workspace)

    # Broadcast to Channel A
    msg_a = {"event": "new_message", "content": "Hello Channel A"}
    await manager.broadcast_to_channel(channel_a, msg_a)

    ws_a1.send_json.assert_awaited_once_with(msg_a)
    ws_a2.send_json.assert_awaited_once_with(msg_a)
    ws_b1.send_json.assert_not_awaited()

    # Broadcast to Channel B
    msg_b = {"event": "new_message", "content": "Hello Channel B"}
    await manager.broadcast_to_channel(channel_b, msg_b)
    ws_b1.send_json.assert_awaited_once_with(msg_b)

    # Broadcast to Workspace
    ws_event = {"event": "task_created", "task_id": "123"}
    await manager.broadcast_to_workspace(workspace_id, ws_event)
    ws_workspace.send_json.assert_awaited_once_with(ws_event)

    # Disconnect and verify cleanup
    manager.disconnect_channel(channel_a, ws_a1)
    manager.disconnect_channel(channel_a, ws_a2)
    assert channel_a not in manager._channel_connections

    manager.disconnect_workspace(workspace_id, ws_workspace)
    assert workspace_id not in manager._workspace_connections


@pytest.mark.asyncio
async def test_websocket_auth_validation(db_session, auth_context: dict) -> None:
    token = auth_context["token"]
    ws_missing = AsyncMock()
    user_none = await authenticate_websocket(ws_missing, None, db_session)
    assert user_none is None
    ws_missing.close.assert_awaited_once()

    ws_invalid = AsyncMock()
    user_invalid = await authenticate_websocket(ws_invalid, "invalid-jwt-token", db_session)
    assert user_invalid is None
    ws_invalid.close.assert_awaited_once()

    ws_valid = AsyncMock()
    user_valid = await authenticate_websocket(ws_valid, token, db_session)
    assert user_valid is not None
    assert isinstance(user_valid, User)


@pytest.mark.asyncio
async def test_channel_websocket_flow(client: AsyncClient, auth_context: dict, db_session) -> None:
    workspace_id = uuid.UUID(auth_context["workspace_id"])
    token = auth_context["token"]

    # 1. Create a channel via REST
    chan_res = await client.post(
        f"/workspaces/{workspace_id}/channels",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "websocket-test-channel"},
    )
    assert chan_res.status_code == 201
    channel_id = uuid.UUID(chan_res.json()["id"])

    # 2. Simulate WebSocket client connecting & interacting
    mock_ws = AsyncMock()
    # Mock messages: first a chat message, then typing indicator, then disconnect
    mock_ws.receive_text.side_effect = [
        '{"action": "message", "content": "Hello from WS!"}',
        '{"action": "typing_start"}',
        Exception("Client disconnected"),
    ]

    await channel_websocket(
        websocket=mock_ws,
        workspace_id=workspace_id,
        channel_id=channel_id,
        token=token,
        db=db_session,
    )

    mock_ws.accept.assert_awaited_once()
    assert mock_ws.send_json.await_count >= 1
    first_call_args = mock_ws.send_json.call_args_list[0][0][0]
    assert first_call_args["event"] == "connected"


@pytest.mark.asyncio
async def test_rest_endpoints_trigger_websocket_broadcasts(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    mock_ws_channel = AsyncMock()
    mock_ws_events = AsyncMock()

    # Create channel
    chan_res = await client.post(
        f"/workspaces/{workspace_id}/channels",
        headers={"Authorization": f"Bearer {token}"},
        json={"name": "sync-channel"},
    )
    assert chan_res.status_code == 201
    channel_id = uuid.UUID(chan_res.json()["id"])

    await ws_manager.connect_channel(channel_id, mock_ws_channel)
    await ws_manager.connect_workspace(uuid.UUID(workspace_id), mock_ws_events)

    try:
        # Post message via REST -> broadcasts to channel
        msg_res = await client.post(
            f"/workspaces/{workspace_id}/channels/{channel_id}/messages",
            headers={"Authorization": f"Bearer {token}"},
            json={"content": "Live sync message via REST"},
        )
        assert msg_res.status_code == 201
        assert mock_ws_channel.send_json.await_count >= 1
        last_call = mock_ws_channel.send_json.call_args_list[-1][0][0]
        assert last_call["event"] == "new_message"
        assert last_call["data"]["content"] == "Live sync message via REST"

        # Create Task via REST -> broadcasts to workspace
        task_res = await client.post(
            f"/workspaces/{workspace_id}/tasks",
            headers={"Authorization": f"Bearer {token}"},
            json={"title": "Kanban real-time card", "status": "todo"},
        )
        assert task_res.status_code == 201
        task_id = task_res.json()["id"]

        assert mock_ws_events.send_json.await_count >= 1
        last_event = mock_ws_events.send_json.call_args_list[-1][0][0]
        assert last_event["event"] == "task_created"
        assert last_event["data"]["title"] == "Kanban real-time card"

        # Update Task via REST -> broadcasts task_updated
        update_res = await client.patch(
            f"/workspaces/{workspace_id}/tasks/{task_id}",
            headers={"Authorization": f"Bearer {token}"},
            json={"status": "in_progress"},
        )
        assert update_res.status_code == 200
        last_event = mock_ws_events.send_json.call_args_list[-1][0][0]
        assert last_event["event"] == "task_updated"
        assert last_event["data"]["status"] == "in_progress"

        # Delete Task via REST -> broadcasts task_deleted
        del_res = await client.delete(
            f"/workspaces/{workspace_id}/tasks/{task_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert del_res.status_code == 204
        last_event = mock_ws_events.send_json.call_args_list[-1][0][0]
        assert last_event["event"] == "task_deleted"
        assert last_event["task_id"] == str(task_id)

    finally:
        ws_manager.disconnect_channel(channel_id, mock_ws_channel)
        ws_manager.disconnect_workspace(uuid.UUID(workspace_id), mock_ws_events)
