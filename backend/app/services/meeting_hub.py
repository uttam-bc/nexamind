"""Live meeting rooms: who is connected, their media state, and targeted WebRTC signaling.

Each browser tab that joins a meeting is a *client* with its own id, so the same person can join
from two devices. Signaling messages (offers, answers, ICE candidates) are delivered only to the
client they are addressed to — never broadcast to the workspace.

State is kept in this process. NexaMind runs one API instance (see docs/OPERATIONS.md); running
several would need these rooms in Redis and sticky routing for the meeting sockets.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from uuid import UUID

from fastapi import WebSocket

logger = logging.getLogger(__name__)


@dataclass
class Client:
    client_id: str
    websocket: WebSocket
    user_id: UUID
    name: str
    is_host: bool
    joined_at: float = field(default_factory=time.time)
    mic: bool = True
    cam: bool = True
    hand: bool = False

    def public(self) -> dict:
        return {
            "client_id": self.client_id,
            "user_id": str(self.user_id),
            "name": self.name,
            "is_host": self.is_host,
            "mic": self.mic,
            "cam": self.cam,
            "hand": self.hand,
            "joined_at": self.joined_at,
        }


@dataclass
class Room:
    meeting_id: UUID
    clients: dict[str, Client] = field(default_factory=dict)
    screen_owner: str | None = None
    empty_since: float | None = field(default_factory=time.time)
    # Everyone who attended at some point (for the MoM attendee list).
    attendance: dict[str, str] = field(default_factory=dict)  # user_id -> name


class MeetingHub:
    def __init__(self) -> None:
        self.rooms: dict[UUID, Room] = {}
        self._lock = asyncio.Lock()

    def room(self, meeting_id: UUID) -> Room:
        if meeting_id not in self.rooms:
            self.rooms[meeting_id] = Room(meeting_id)
        return self.rooms[meeting_id]

    def participants(self, meeting_id: UUID) -> list[dict]:
        room = self.rooms.get(meeting_id)
        return [c.public() for c in room.clients.values()] if room else []

    def attendance(self, meeting_id: UUID) -> dict[str, str]:
        room = self.rooms.get(meeting_id)
        return dict(room.attendance) if room else {}

    def connected_count(self, meeting_id: UUID) -> int:
        room = self.rooms.get(meeting_id)
        return len(room.clients) if room else 0

    async def join(self, meeting_id: UUID, websocket: WebSocket, user_id: UUID, name: str, is_host: bool,
                   mic: bool = True, cam: bool = True) -> Client:
        async with self._lock:
            room = self.room(meeting_id)
            client = Client(uuid.uuid4().hex, websocket, user_id, name, is_host, mic=mic, cam=cam)
            room.clients[client.client_id] = client
            room.empty_since = None
            room.attendance[str(user_id)] = name
        await self.broadcast(meeting_id, {"type": "participant_joined", "participant": client.public()},
                             exclude=client.client_id)
        return client

    async def leave(self, meeting_id: UUID, client_id: str) -> None:
        async with self._lock:
            room = self.rooms.get(meeting_id)
            if not room or client_id not in room.clients:
                return
            room.clients.pop(client_id)
            stopped_sharing = room.screen_owner == client_id
            if stopped_sharing:
                room.screen_owner = None
            if not room.clients:
                room.empty_since = time.time()
        await self.broadcast(meeting_id, {"type": "participant_left", "client_id": client_id})
        if stopped_sharing:
            await self.broadcast(meeting_id, {"type": "screen_share", "client_id": client_id, "active": False})

    async def send(self, meeting_id: UUID, client_id: str, message: dict) -> bool:
        room = self.rooms.get(meeting_id)
        client = room.clients.get(client_id) if room else None
        if client is None:
            return False
        try:
            await client.websocket.send_json(message)
            return True
        except Exception:
            return False

    async def broadcast(self, meeting_id: UUID, message: dict, exclude: str | None = None) -> None:
        room = self.rooms.get(meeting_id)
        if not room:
            return
        for client in list(room.clients.values()):
            if client.client_id == exclude:
                continue
            try:
                await client.websocket.send_json(message)
            except Exception:
                pass  # the socket's own handler removes it when it notices the disconnect

    async def set_state(self, meeting_id: UUID, client_id: str, **changes) -> dict | None:
        room = self.rooms.get(meeting_id)
        client = room.clients.get(client_id) if room else None
        if client is None:
            return None
        for key in ("mic", "cam", "hand"):
            if key in changes and isinstance(changes[key], bool):
                setattr(client, key, changes[key])
        public = client.public()
        await self.broadcast(meeting_id, {"type": "participant_state", "participant": public})
        return public

    async def set_screen_share(self, meeting_id: UUID, client_id: str, active: bool) -> tuple[bool, str | None]:
        """One presenter at a time. Returns (accepted, current owner)."""
        async with self._lock:
            room = self.rooms.get(meeting_id)
            if not room or client_id not in room.clients:
                return False, None
            if active:
                if room.screen_owner and room.screen_owner != client_id and room.screen_owner in room.clients:
                    return False, room.screen_owner
                room.screen_owner = client_id
            elif room.screen_owner == client_id:
                room.screen_owner = None
            else:
                return True, room.screen_owner
        await self.broadcast(meeting_id, {"type": "screen_share", "client_id": client_id, "active": active})
        return True, room.screen_owner

    async def end(self, meeting_id: UUID, ended_by_name: str) -> None:
        """Tell every client the meeting is over and close their sockets."""
        room = self.rooms.pop(meeting_id, None)
        if not room:
            return
        for client in list(room.clients.values()):
            try:
                await client.websocket.send_json({"type": "meeting_ended", "ended_by": ended_by_name})
                await client.websocket.close(code=4000, reason="Meeting ended")
            except Exception:
                pass

    def empty_for(self, meeting_id: UUID) -> float | None:
        """Seconds the room has been empty (None if someone is connected; inf if never seen)."""
        room = self.rooms.get(meeting_id)
        if room is None:
            return float("inf")
        if room.clients:
            return None
        return time.time() - (room.empty_since or time.time())


meeting_hub = MeetingHub()
