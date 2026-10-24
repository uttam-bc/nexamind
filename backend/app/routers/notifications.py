from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    limit: int = Query(30, ge=1, le=100),
    before: datetime | None = Query(None),
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    items = await notification_service.list_for_user(db, current_user.id, limit, before, unread_only)
    return {
        "items": [notification_service.serialize(n) for n in items],
        "unread_count": await notification_service.unread_count(db, current_user.id),
        "has_more": len(items) == limit,
    }


class MarkRead(BaseModel):
    ids: list[UUID] = Field(min_length=1, max_length=200)


@router.post("/read")
async def mark_read(data: MarkRead, current_user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db, scope="function")) -> dict:
    await notification_service.mark_read(db, current_user.id, data.ids)
    return {"unread_count": await notification_service.unread_count(db, current_user.id)}


@router.post("/read-all")
async def mark_all_read(current_user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db, scope="function")) -> dict:
    await notification_service.mark_all_read(db, current_user.id)
    return {"unread_count": 0}


@router.get("/preferences")
async def get_preferences(current_user: User = Depends(get_current_user)) -> dict:
    return notification_service.get_prefs(current_user)


@router.put("/preferences")
async def set_preferences(data: dict[str, bool], current_user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db, scope="function")) -> dict:
    return await notification_service.set_prefs(db, current_user, data)
