"""In-app notifications: stored per user, de-duplicated, pushed in real time.

Every notification comes from a real event (an invitation, an assignment, a reminder...). The
`dedupe_key` makes each event notify a person at most once, so retries, regenerated MoMs and the
reminder job never produce duplicates. Users can switch categories off in their preferences.
"""

import logging
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification, User
from app.services.websocket_manager import ws_manager

logger = logging.getLogger(__name__)

CATEGORIES = ("meetings", "tasks", "messages", "mom")


def iso_utc(value: datetime | None) -> str | None:
    """Stored in UTC; SQLite drops the zone, so a naive value is labelled UTC explicitly."""
    if value is None:
        return None
    return (value if value.tzinfo else value.replace(tzinfo=UTC)).isoformat()


def serialize(n: Notification) -> dict:
    return {
        "id": str(n.id),
        "workspace_id": str(n.workspace_id) if n.workspace_id else None,
        "kind": n.kind,
        "category": n.category,
        "title": n.title,
        "body": n.body,
        "link": n.link or {},
        "read": n.read_at is not None,
        "read_at": iso_utc(n.read_at),
        "created_at": iso_utc(n.created_at),
    }


def _enabled(user: User | None, category: str) -> bool:
    prefs = (user.notification_prefs or {}) if user else {}
    return prefs.get(category, True) is not False


async def notify(
    db: AsyncSession,
    user_id: UUID | None,
    *,
    kind: str,
    category: str,
    title: str,
    dedupe_key: str,
    workspace_id: UUID | None = None,
    body: str | None = None,
    link: dict | None = None,
    actor_id: UUID | None = None,
) -> Notification | None:
    """Create one notification unless the user muted the category, is the actor, or already has it."""
    if user_id is None or (actor_id is not None and user_id == actor_id):
        return None
    if category not in CATEGORIES:
        raise ValueError(f"Unknown notification category {category!r}")
    user = await db.get(User, user_id)
    if user is None or user.deactivated_at is not None or not _enabled(user, category):
        return None
    existing = (await db.execute(
        select(Notification.id).where(Notification.user_id == user_id, Notification.dedupe_key == dedupe_key)
    )).first()
    if existing:
        return None
    notification = Notification(
        user_id=user_id, workspace_id=workspace_id, kind=kind, category=category,
        title=title[:255], body=(body or None) and body[:2000], link=link or {}, dedupe_key=dedupe_key[:160],
    )
    try:
        async with db.begin_nested():
            db.add(notification)
            await db.flush()
    except IntegrityError:  # a concurrent request created it first
        return None
    await ws_manager.send_to_user(user_id, {"type": "notification", "notification": serialize(notification)})
    return notification


async def notify_many(db: AsyncSession, user_ids, **kwargs) -> int:
    created = 0
    for uid in dict.fromkeys(u for u in user_ids if u):  # unique, order kept
        if await notify(db, uid, **kwargs):
            created += 1
    return created


async def list_for_user(db: AsyncSession, user_id: UUID, limit: int = 30, before: datetime | None = None,
                        unread_only: bool = False) -> list[Notification]:
    query = select(Notification).where(Notification.user_id == user_id)
    if before is not None:
        query = query.where(Notification.created_at < before)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    query = query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)
    return list((await db.execute(query)).scalars().all())


async def unread_count(db: AsyncSession, user_id: UUID) -> int:
    return (await db.execute(
        select(func.count(Notification.id)).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    )).scalar() or 0


async def mark_read(db: AsyncSession, user_id: UUID, ids: list[UUID]) -> int:
    if not ids:
        return 0
    result = await db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.id.in_(ids), Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    return result.rowcount or 0


async def mark_all_read(db: AsyncSession, user_id: UUID) -> int:
    result = await db.execute(
        update(Notification)
        .where(Notification.user_id == user_id, Notification.read_at.is_(None))
        .values(read_at=datetime.now(UTC))
    )
    return result.rowcount or 0


def get_prefs(user: User) -> dict:
    prefs = user.notification_prefs or {}
    return {category: prefs.get(category, True) is not False for category in CATEGORIES}


async def set_prefs(db: AsyncSession, user: User, changes: dict) -> dict:
    prefs = dict(user.notification_prefs or {})
    for category, enabled in changes.items():
        if category in CATEGORIES:
            prefs[category] = bool(enabled)
    user.notification_prefs = prefs
    await db.flush()
    return get_prefs(user)
