from __future__ import annotations

import logging
from collections import defaultdict
from uuid import UUID

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages active WebSocket connections for channels and workspace events."""

    def __init__(self) -> None:
        self._channel_connections: dict[UUID, set[WebSocket]] = defaultdict(set)
        self._workspace_connections: dict[UUID, set[WebSocket]] = defaultdict(set)

    async def connect_channel(self, channel_id: UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self._channel_connections[channel_id].add(websocket)
        logger.debug("WebSocket client connected to channel %s (total: %d)", channel_id, len(self._channel_connections[channel_id]))

    def disconnect_channel(self, channel_id: UUID, websocket: WebSocket) -> None:
        self._channel_connections[channel_id].discard(websocket)
        if not self._channel_connections[channel_id]:
            self._channel_connections.pop(channel_id, None)
        logger.debug("WebSocket client disconnected from channel %s", channel_id)

    async def broadcast_to_channel(self, channel_id: UUID, message: dict) -> None:
        if channel_id not in self._channel_connections:
            return

        dead_connections: list[WebSocket] = []
        for connection in list(self._channel_connections[channel_id]):
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning("Error sending message to WebSocket client: %s", e)
                dead_connections.append(connection)

        for dead in dead_connections:
            self.disconnect_channel(channel_id, dead)

    async def connect_workspace(self, workspace_id: UUID, websocket: WebSocket) -> None:
        await websocket.accept()
        self._workspace_connections[workspace_id].add(websocket)
        logger.debug("WebSocket client connected to workspace %s events (total: %d)", workspace_id, len(self._workspace_connections[workspace_id]))

    def disconnect_workspace(self, workspace_id: UUID, websocket: WebSocket) -> None:
        self._workspace_connections[workspace_id].discard(websocket)
        if not self._workspace_connections[workspace_id]:
            self._workspace_connections.pop(workspace_id, None)
        logger.debug("WebSocket client disconnected from workspace %s events", workspace_id)

    async def broadcast_to_workspace(self, workspace_id: UUID, event: dict) -> None:
        if workspace_id not in self._workspace_connections:
            return

        dead_connections: list[WebSocket] = []
        for connection in list(self._workspace_connections[workspace_id]):
            try:
                await connection.send_json(event)
            except Exception as e:
                logger.warning("Error broadcasting workspace event: %s", e)
                dead_connections.append(connection)

        for dead in dead_connections:
            self.disconnect_workspace(workspace_id, dead)


ws_manager = ConnectionManager()
