"""WebRTC configuration for meetings. Meetings themselves live in app/routers/meetings.py."""

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.services.auth_service import AuthError
from app.services.workspace_service import get_workspace_membership

router = APIRouter(prefix="/workspaces/{workspace_id}/video", tags=["video"])


@router.get("/ice-servers")
async def get_ice_servers(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    """WebRTC ICE servers for meetings. TURN credentials only go to workspace members."""
    if not await get_workspace_membership(db, workspace_id, current_user.id):
        raise AuthError("Workspace not found or access denied", status_code=404)
    settings = get_settings()
    servers: list[dict] = [{"urls": url} for url in settings.webrtc_stun_urls]
    if settings.webrtc_turn_urls:
        turn = {"urls": settings.webrtc_turn_urls}
        if settings.webrtc_turn_username and settings.webrtc_turn_credential:
            turn.update(username=settings.webrtc_turn_username, credential=settings.webrtc_turn_credential)
        servers.append(turn)
    return {"iceServers": servers, "relay_available": bool(settings.webrtc_turn_urls)}
