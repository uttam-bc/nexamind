import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient

from app.models import User
from app.routers.websockets import _authenticate, channel_websocket
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
    manager.add_channel(channel_a, ws_a1)
    manager.add_channel(channel_a, ws_a2)
    manager.add_channel(channel_b, ws_b1)
    manager.add_workspace(workspace_id, ws_workspace)

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

    # No token in the URL and no auth frame -> closed
    ws_missing = AsyncMock()
    ws_missing.receive_text.return_value = '{"type": "ping"}'
    assert await _authenticate(ws_missing, None) is None
    ws_missing.close.assert_awaited_once()

    ws_invalid = AsyncMock()
    assert await _authenticate(ws_invalid, "invalid-jwt-token") is None
    ws_invalid.close.assert_awaited_once()

    # Token sent as the first frame (keeps it out of URLs and logs)
    ws_frame = AsyncMock()
    ws_frame.receive_text.return_value = f'{{"type": "auth", "token": "{token}"}}'
    user = await _authenticate(ws_frame, None)
    assert isinstance(user, User)
    ws_frame.close.assert_not_awaited()

    # Legacy query-string token still works
    ws_query = AsyncMock()
    assert isinstance(await _authenticate(ws_query, token), User)


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
        f'{{"type": "auth", "token": "{token}"}}',
        '{"action": "message", "content": "Hello from WS!"}',
        '{"action": "typing_start"}',
        Exception("Client disconnected"),
    ]

    await channel_websocket(
        websocket=mock_ws,
        workspace_id=workspace_id,
        channel_id=channel_id,
        token=None,
    )

    mock_ws.accept.assert_awaited_once()
    assert mock_ws.send_json.await_count >= 1
    first_call_args = mock_ws.send_json.call_args_list[0][0][0]
    assert first_call_args["event"] == "connected"

    # The message sent over the socket was persisted
    msgs = await client.get(
        f"/workspaces/{workspace_id}/channels/{channel_id}/messages",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert [m["content"] for m in msgs.json()] == ["Hello from WS!"]


@pytest.mark.asyncio
async def test_channel_websocket_rejects_non_members(client: AsyncClient, auth_context: dict) -> None:
    workspace_id = uuid.UUID(auth_context["workspace_id"])
    channels = await client.get(
        f"/workspaces/{workspace_id}/channels",
        headers={"Authorization": f"Bearer {auth_context['token']}"},
    )
    channel_id = uuid.UUID(channels.json()[0]["id"])
    outsider = await client.post(
        "/auth/register",
        json={"email": "outsider@example.com", "password": "securepass123", "name": "Outsider"},
    )
    mock_ws = AsyncMock()
    await channel_websocket(websocket=mock_ws, workspace_id=workspace_id, channel_id=channel_id,
                            token=outsider.json()["access_token"])
    mock_ws.close.assert_awaited_once()
    assert mock_ws.receive_text.await_count == 0


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

    ws_manager.add_channel(channel_id, mock_ws_channel)
    ws_manager.add_workspace(uuid.UUID(workspace_id), mock_ws_events)

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


class _FakeRedis:
    """Just enough of redis.asyncio for ConnectionManager: hashes plus pub/sub fan-out."""

    def __init__(self) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self.subscribers: list[asyncio.Queue] = []

    async def hset(self, name, field, value):
        self.hashes.setdefault(name, {})[field] = value

    async def hget(self, name, field):
        return self.hashes.get(name, {}).get(field)

    async def hdel(self, name, field):
        self.hashes.get(name, {}).pop(field, None)

    async def hgetall(self, name):
        return dict(self.hashes.get(name, {}))

    async def publish(self, channel, data):
        for queue in self.subscribers:
            queue.put_nowait({"type": "message", "data": data})

    def pubsub(self):
        redis = self
        queue: asyncio.Queue = asyncio.Queue()

        class _PubSub:
            async def subscribe(self, _channel):
                redis.subscribers.append(queue)

            async def listen(self):
                while True:
                    yield await queue.get()

            async def aclose(self):
                pass

        return _PubSub()


@pytest.mark.asyncio
async def test_events_reach_clients_on_other_instances_via_redis() -> None:
    from app.services import websocket_manager as wm

    shared = _FakeRedis()
    instance_a, instance_b = ConnectionManager(), ConnectionManager()
    for manager in (instance_a, instance_b):
        manager._redis = shared
        manager.state.use_redis(shared)
        pubsub = shared.pubsub()
        await pubsub.subscribe(wm.PUBSUB_CHANNEL)
        manager._listener = asyncio.create_task(manager._listen(pubsub))

    workspace_id = uuid.uuid4()
    client_on_b = AsyncMock()
    instance_b.add_workspace(workspace_id, client_on_b)

    try:
        await instance_a.broadcast_to_workspace(workspace_id, {"event": "task_created"})
        await instance_a.set_presence(workspace_id, uuid.uuid4(), "Ada", "online")
        await asyncio.sleep(0.05)
        client_on_b.send_json.assert_awaited_once_with({"event": "task_created"})
        assert [p["name"] for p in await instance_b.get_workspace_presence(workspace_id)] == ["Ada"]
    finally:
        for manager in (instance_a, instance_b):
            manager._listener.cancel()
