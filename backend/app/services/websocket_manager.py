"""Real-time fan-out for WebSocket clients.

With a single API process everything stays in memory. When REDIS_URL is set, broadcasts go
through Redis pub/sub and shared state (presence, live video rooms) lives in Redis hashes, so
clients connected to different API instances still see each other's events.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict
from uuid import UUID

from fastapi import WebSocket

from app.config import get_settings

logger = logging.getLogger(__name__)

PUBSUB_CHANNEL = "nexamind:events"


class SharedState:
    """Hash-of-JSON store: local dict by default, Redis when configured."""

    def __init__(self) -> None:
        self._local: dict[str, dict[str, dict]] = defaultdict(dict)
        self._redis = None

    def use_redis(self, redis_client) -> None:
        self._redis = redis_client

    async def hset(self, name: str, field: str, value: dict) -> None:
        if self._redis is not None:
            await self._redis.hset(f"nexamind:{name}", field, json.dumps(value))
        else:
            self._local[name][field] = value

    async def hget(self, name: str, field: str) -> dict | None:
        if self._redis is not None:
            raw = await self._redis.hget(f"nexamind:{name}", field)
            return json.loads(raw) if raw else None
        return self._local.get(name, {}).get(field)

    async def hdel(self, name: str, field: str) -> dict | None:
        if self._redis is not None:
            raw = await self._redis.hget(f"nexamind:{name}", field)
            await self._redis.hdel(f"nexamind:{name}", field)
            return json.loads(raw) if raw else None
        bucket = self._local.get(name, {})
        value = bucket.pop(field, None)
        if not bucket:
            self._local.pop(name, None)
        return value

    async def hgetall(self, name: str) -> dict[str, dict]:
        if self._redis is not None:
            raw = await self._redis.hgetall(f"nexamind:{name}")
            return {k: json.loads(v) for k, v in raw.items()}
        return dict(self._local.get(name, {}))


class ConnectionManager:
    """Tracks WebSocket connections per channel and per workspace."""

    def __init__(self) -> None:
        self._channel_connections: dict[UUID, set[WebSocket]] = defaultdict(set)
        self._workspace_connections: dict[UUID, set[WebSocket]] = defaultdict(set)
        # Personal stream (notifications), one entry per open tab/device of the user.
        self._user_connections: dict[UUID, set[WebSocket]] = defaultdict(set)
        self.state = SharedState()
        self._redis = None
        self._listener: asyncio.Task | None = None

    # ---- lifecycle -------------------------------------------------------------------------

    async def start(self) -> None:
        redis_url = get_settings().redis_url
        if not redis_url:
            return
        import redis.asyncio as redis_asyncio

        self._redis = redis_asyncio.from_url(redis_url, decode_responses=True)
        await self._redis.ping()
        self.state.use_redis(self._redis)
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(PUBSUB_CHANNEL)
        self._listener = asyncio.create_task(self._listen(pubsub))
        logger.info("Real-time events use Redis pub/sub")

    async def stop(self) -> None:
        if self._listener:
            self._listener.cancel()
            self._listener = None
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None
            self.state.use_redis(None)

    async def _listen(self, pubsub) -> None:
        try:
            async for item in pubsub.listen():
                if item.get("type") != "message":
                    continue
                try:
                    envelope = json.loads(item["data"])
                    target = UUID(envelope["id"])
                    if envelope["scope"] == "channel":
                        await self._deliver(self._channel_connections, target, envelope["payload"])
                    elif envelope["scope"] == "user":
                        await self._deliver(self._user_connections, target, envelope["payload"])
                    else:
                        await self._deliver(self._workspace_connections, target, envelope["payload"])
                except Exception as exc:  # keep the listener alive on malformed events
                    logger.warning("Dropped malformed real-time event: %s", exc)
        except asyncio.CancelledError:
            await pubsub.aclose()
            raise

    # ---- presence ------------------------------------------------------------------------

    async def set_presence(self, workspace_id: UUID, user_id: UUID, name: str, status: str = "online") -> None:
        await self.state.hset(
            f"presence:{workspace_id}",
            str(user_id),
            {"user_id": str(user_id), "name": name, "status": status},
        )

    async def remove_presence(self, workspace_id: UUID, user_id: UUID) -> None:
        await self.state.hdel(f"presence:{workspace_id}", str(user_id))

    async def get_workspace_presence(self, workspace_id: UUID) -> list[dict]:
        return list((await self.state.hgetall(f"presence:{workspace_id}")).values())

    # ---- connections -----------------------------------------------------------------------

    def add_channel(self, channel_id: UUID, websocket: WebSocket) -> None:
        self._channel_connections[channel_id].add(websocket)

    def disconnect_channel(self, channel_id: UUID, websocket: WebSocket) -> None:
        self._discard(self._channel_connections, channel_id, websocket)

    def add_workspace(self, workspace_id: UUID, websocket: WebSocket) -> None:
        self._workspace_connections[workspace_id].add(websocket)

    def disconnect_workspace(self, workspace_id: UUID, websocket: WebSocket) -> None:
        self._discard(self._workspace_connections, workspace_id, websocket)

    def add_user(self, user_id: UUID, websocket: WebSocket) -> None:
        self._user_connections[user_id].add(websocket)

    def disconnect_user(self, user_id: UUID, websocket: WebSocket) -> None:
        self._discard(self._user_connections, user_id, websocket)

    @staticmethod
    def _discard(registry: dict[UUID, set[WebSocket]], key: UUID, websocket: WebSocket) -> None:
        connections = registry.get(key)
        if connections is None:
            return
        connections.discard(websocket)
        if not connections:
            registry.pop(key, None)

    # ---- broadcasting ----------------------------------------------------------------------

    async def broadcast_to_channel(self, channel_id: UUID, message: dict) -> None:
        await self._publish("channel", channel_id, message, self._channel_connections)

    async def broadcast_to_workspace(self, workspace_id: UUID, event: dict) -> None:
        await self._publish("workspace", workspace_id, event, self._workspace_connections)

    async def send_to_user(self, user_id: UUID, event: dict) -> None:
        await self._publish("user", user_id, event, self._user_connections)

    async def _publish(self, scope: str, target: UUID, payload: dict, registry: dict[UUID, set[WebSocket]]) -> None:
        if self._redis is not None:
            envelope = {"scope": scope, "id": str(target), "payload": payload}
            try:
                await self._redis.publish(PUBSUB_CHANNEL, json.dumps(envelope, default=str))
                return
            except Exception as exc:
                logger.warning("Redis publish failed, delivering locally only: %s", exc)
        await self._deliver(registry, target, payload)

    async def _deliver(self, registry: dict[UUID, set[WebSocket]], target: UUID, payload: dict) -> None:
        connections = registry.get(target)
        if not connections:
            return
        dead: list[WebSocket] = []
        for connection in list(connections):
            try:
                await connection.send_json(payload)
            except Exception:
                dead.append(connection)
        for connection in dead:
            self._discard(registry, target, connection)


ws_manager = ConnectionManager()
