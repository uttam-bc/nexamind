from uuid import UUID

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.session import SessionResponse
from app.services.video_service import (
    create_video_room,
    end_video_room,
    join_video_room,
    list_active_rooms,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/video", tags=["video"])


class VideoRoomCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class VideoRoomEndRequest(BaseModel):
    notes: str | None = None


class VideoRoomResponse(BaseModel):
    room_id: str
    workspace_id: str
    name: str
    created_by: str
    creator_name: str
    room_url: str
    status: str
    participants: list[dict]


@router.post("/rooms", response_model=VideoRoomResponse, status_code=status.HTTP_201_CREATED)
async def start_video_room(
    workspace_id: UUID,
    data: VideoRoomCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VideoRoomResponse:
    room = await create_video_room(db, workspace_id, current_user, data.name)
    return VideoRoomResponse.model_validate(room)


@router.get("/rooms", response_model=list[VideoRoomResponse])
async def get_active_video_rooms(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[VideoRoomResponse]:
    rooms = await list_active_rooms(db, workspace_id, current_user.id)
    return [VideoRoomResponse.model_validate(r) for r in rooms]


@router.post("/rooms/{room_id}/join", response_model=VideoRoomResponse)
async def join_room(
    workspace_id: UUID,
    room_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VideoRoomResponse:
    room = await join_video_room(db, workspace_id, current_user, room_id)
    return VideoRoomResponse.model_validate(room)


@router.post("/rooms/{room_id}/end", response_model=SessionResponse, status_code=status.HTTP_200_OK)
async def end_and_summarize_room(
    workspace_id: UUID,
    room_id: str,
    data: VideoRoomEndRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    session = await end_video_room(db, workspace_id, current_user, room_id, notes=data.notes)
    return SessionResponse.model_validate(session)
