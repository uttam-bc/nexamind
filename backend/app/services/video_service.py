import logging
import uuid
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SessionRecord, SessionSource, SessionStatus, User
from app.services.ai_service import summarize_meeting_transcript
from app.services.auth_service import AuthError
from app.services.websocket_manager import ws_manager
from app.services.workspace_service import get_workspace_membership

logger = logging.getLogger(__name__)


def _rooms_key(workspace_id: UUID) -> str:
    # Active rooms are kept in the shared real-time store (memory, or Redis when configured).
    return f"video_rooms:{workspace_id}"


async def create_video_room(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    room_name: str,
) -> dict:
    """Creates or joins the single active live video conferencing room for the workspace."""
    await _require_workspace_access(db, workspace_id, user.id)

    # Enforce single active meeting per workspace: reuse ongoing meeting if exists
    for r in (await ws_manager.state.hgetall(_rooms_key(workspace_id))).values():
        if r.get("workspace_id") == str(workspace_id):
            if not any(p["id"] == str(user.id) for p in r["participants"]):
                r["participants"].append({"id": str(user.id), "name": user.name, "role": "participant"})
                await ws_manager.state.hset(_rooms_key(workspace_id), r["room_id"], r)
                await ws_manager.broadcast_to_workspace(
                    workspace_id,
                    {
                        "event": "video_room_user_joined",
                        "workspace_id": str(workspace_id),
                        "room_id": r["room_id"],
                        "user_id": str(user.id),
                        "user_name": user.name,
                        "participants": r["participants"],
                    },
                )
            return r

    room_id = f"room-{uuid.uuid4().hex[:12]}"
    room_data = {
        "room_id": room_id,
        "workspace_id": str(workspace_id),
        "name": room_name.strip(),
        "created_by": str(user.id),
        "creator_name": user.name,
        "room_url": f"/meetings/{room_id}",
        "status": "active",
        "participants": [{"id": str(user.id), "name": user.name, "role": "host"}],
    }
    await ws_manager.state.hset(_rooms_key(workspace_id), room_id, room_data)

    # Broadcast room creation to workspace event stream
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {
            "event": "video_room_started",
            "workspace_id": str(workspace_id),
            "room_id": room_id,
            "room_name": room_name,
            "creator": user.name,
            "participants": room_data["participants"],
        },
    )

    return room_data


async def join_video_room(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    room_id: str,
) -> dict:
    """Joins an active video conferencing room."""
    await _require_workspace_access(db, workspace_id, user.id)

    rooms = await ws_manager.state.hgetall(_rooms_key(workspace_id))
    room = rooms.get(room_id) or next(iter(rooms.values()), None)

    if not room:
        raise AuthError("Video meeting room not found or expired", status_code=404)

    # Check if participant is already listed
    if not any(p["id"] == str(user.id) for p in room["participants"]):
        room["participants"].append({"id": str(user.id), "name": user.name, "role": "participant"})
        await ws_manager.state.hset(_rooms_key(workspace_id), room["room_id"], room)
        await ws_manager.broadcast_to_workspace(
            workspace_id,
            {
                "event": "video_room_user_joined",
                "workspace_id": str(workspace_id),
                "room_id": room["room_id"],
                "user_id": str(user.id),
                "user_name": user.name,
                "participants": room["participants"],
            },
        )

    return room


async def end_video_room(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    room_id: str,
    notes: str | None = None,
) -> SessionRecord:
    """Ends live video call, generates AI summary from meeting notes, and saves as Session."""
    await _require_workspace_access(db, workspace_id, user.id)

    # Only rooms belonging to this workspace can be ended from it.
    room = await ws_manager.state.hdel(_rooms_key(workspace_id), room_id)
    if room is None:
        raise AuthError("Video meeting room not found or already ended", status_code=404)
    room_title = room.get("name") or "Live Video Meeting"
    transcript_content = notes.strip() if notes else ""

    summary, action_items = await summarize_meeting_transcript(transcript_content, room_title)

    session = SessionRecord(
        workspace_id=workspace_id,
        title=f"Live Meeting: {room_title}",
        source=SessionSource.LIVE,
        transcript=transcript_content,
        ai_summary=summary,
        action_items=action_items,
        status=SessionStatus.DONE,
        created_by=user.id,
    )
    db.add(session)
    await db.flush()
    await db.refresh(session)

    # Broadcast meeting ended & session saved
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {
            "event": "video_room_ended",
            "workspace_id": str(workspace_id),
            "room_id": room_id,
            "session_id": str(session.id),
            "summary": summary,
        },
    )

    return session


async def list_active_rooms(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> list[dict]:
    """Lists active video rooms in the workspace."""
    await _require_workspace_access(db, workspace_id, user_id)
    return list((await ws_manager.state.hgetall(_rooms_key(workspace_id))).values())


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
