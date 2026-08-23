from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.models.calendar import CalendarEventType
from app.schemas.calendar import (
    CalendarEventCreate,
    CalendarEventResponse,
    CalendarEventUpdate,
    DetectedRemindersResponse,
)
from app.services.calendar_service import (
    create_calendar_event,
    delete_calendar_event,
    detect_ai_reminders_from_context,
    get_calendar_event,
    list_calendar_events,
    update_calendar_event,
)
from app.services.websocket_manager import ws_manager

router = APIRouter(prefix="/workspaces/{workspace_id}/calendar", tags=["calendar"])


@router.get("/events", response_model=list[CalendarEventResponse])
async def get_workspace_calendar_events(
    workspace_id: UUID,
    event_type: CalendarEventType | None = Query(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[CalendarEventResponse]:
    events = await list_calendar_events(db, workspace_id, current_user.id, event_type=event_type)
    return [CalendarEventResponse.model_validate(e) for e in events]


@router.post("/events", response_model=CalendarEventResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace_calendar_event(
    workspace_id: UUID,
    data: CalendarEventCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CalendarEventResponse:
    event = await create_calendar_event(db, workspace_id, current_user, data)
    event_data = CalendarEventResponse.model_validate(event).model_dump(mode="json")
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "calendar_event_created", "workspace_id": str(workspace_id), "data": event_data},
    )
    return CalendarEventResponse.model_validate(event)


@router.get("/events/{event_id}", response_model=CalendarEventResponse)
async def get_workspace_calendar_event_detail(
    workspace_id: UUID,
    event_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CalendarEventResponse:
    event = await get_calendar_event(db, workspace_id, event_id, current_user.id)
    return CalendarEventResponse.model_validate(event)


@router.patch("/events/{event_id}", response_model=CalendarEventResponse)
async def update_workspace_calendar_event_detail(
    workspace_id: UUID,
    event_id: UUID,
    data: CalendarEventUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CalendarEventResponse:
    event = await update_calendar_event(db, workspace_id, event_id, current_user.id, data)
    event_data = CalendarEventResponse.model_validate(event).model_dump(mode="json")
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "calendar_event_updated", "workspace_id": str(workspace_id), "data": event_data},
    )
    return CalendarEventResponse.model_validate(event)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_calendar_event_detail(
    workspace_id: UUID,
    event_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_calendar_event(db, workspace_id, event_id, current_user.id)
    await ws_manager.broadcast_to_workspace(
        workspace_id,
        {"event": "calendar_event_deleted", "workspace_id": str(workspace_id), "event_id": str(event_id)},
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/detect-reminders", response_model=DetectedRemindersResponse)
async def detect_reminders(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DetectedRemindersResponse:
    items = await detect_ai_reminders_from_context(db, workspace_id, current_user.id)
    return DetectedRemindersResponse(reminders=items, count=len(items))
