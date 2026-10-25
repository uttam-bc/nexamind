"""Files and pages attached to chat messages (channels, DMs and meeting chat).

Two kinds of attachment:
- **Uploads**: files sent in the conversation. Stored as `FileRecord`s scoped to that channel or
  meeting (`channel_id`/`meeting_id`), so only people who can read the conversation can open them
  and they never appear in the workspace Files library. The original bytes are kept as uploaded.
- **Shared references**: a file or Docs page that already exists in a workspace library. Nothing
  is copied; opening it checks the viewer's access to the original at that moment.

Uploads happen first (one request per file, with progress), then the message is sent with the
upload ids. A retried upload or message (same client id) is stored once. Uploads never attached
to a message are removed by `cleanup_unsent_uploads` (background job).
"""

import uuid
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import AttachmentKind, Document, FileRecord, MessageAttachment, User
from app.services import storage
from app.services.auth_service import AuthError
from app.services.upload_utils import (
    classify_upload,
    delete_stored_file,
    safe_extension,
    sanitize_filename,
    save_upload,
    upload_root,
)
from app.services.workspace_service import get_workspace_membership

MAX_ATTACHMENTS = 10
UNSENT_UPLOAD_TTL = timedelta(hours=24)


async def store_upload(
    db: AsyncSession,
    *,
    workspace_id: UUID,
    user: User,
    upload: UploadFile,
    client_upload_id: str | None,
    channel_id: UUID | None = None,
    meeting_id: UUID | None = None,
) -> FileRecord:
    """Save one chat upload, scoped to its conversation. Callers check access to the conversation."""
    if client_upload_id:
        existing = await _existing_upload(db, user.id, client_upload_id)
        if existing is not None:
            if existing.channel_id != channel_id or existing.meeting_id != meeting_id:
                raise AuthError("This upload id was already used in another conversation", status_code=409)
            return existing

    file_uuid = uuid.uuid4()
    filename = sanitize_filename(upload.filename, fallback="file")
    target = upload_root() / "chat" / str(workspace_id) / f"{file_uuid}{safe_extension(filename)}"
    size = await save_upload(upload, target, get_settings().max_upload_mb * 1024 * 1024)
    try:
        mime = classify_upload(target, filename)
    except AuthError:
        delete_stored_file(str(target))
        raise
    if size == 0:
        delete_stored_file(str(target))
        raise AuthError(f"“{filename}” is empty", status_code=400)
    stored = await storage.persist_upload(target, f"chat/{workspace_id}/{target.name}", content_type=mime)

    record = FileRecord(
        id=file_uuid, workspace_id=workspace_id, filename=filename, file_path=stored, file_size=size,
        mime_type=mime, uploaded_by=user.id, channel_id=channel_id, meeting_id=meeting_id,
        client_upload_id=client_upload_id,
    )
    try:
        async with db.begin_nested():
            db.add(record)
            await db.flush()
    except IntegrityError:  # the same upload finished in a parallel request
        if record in db:
            db.expunge(record)
        delete_stored_file(stored)
        existing = await _existing_upload(db, user.id, client_upload_id)
        if existing is None:
            raise
        return existing
    return record


async def _existing_upload(db: AsyncSession, user_id: UUID, client_upload_id: str | None) -> FileRecord | None:
    if not client_upload_id:
        return None
    return (await db.execute(select(FileRecord).where(
        FileRecord.uploaded_by == user_id, FileRecord.client_upload_id == client_upload_id))).scalar_one_or_none()


async def _is_member(db: AsyncSession, workspace_id: UUID, user_id: UUID) -> bool:
    return bool(await get_workspace_membership(db, workspace_id, user_id))


async def collect(
    db: AsyncSession,
    user: User,
    *,
    upload_ids: list[UUID],
    file_ids: list[UUID],
    document_ids: list[UUID],
    channel_id: UUID | None = None,
    meeting_id: UUID | None = None,
) -> list[MessageAttachment]:
    """Validate what the sender wants to attach and build (unsaved) attachment rows, in order."""
    total = len(upload_ids) + len(file_ids) + len(document_ids)
    if total > MAX_ATTACHMENTS:
        raise AuthError(f"A message can carry at most {MAX_ATTACHMENTS} files", status_code=400)
    rows: list[MessageAttachment] = []

    if upload_ids:
        scope = FileRecord.channel_id == channel_id if channel_id else FileRecord.meeting_id == meeting_id
        uploads = {f.id: f for f in (await db.execute(select(FileRecord).where(
            FileRecord.id.in_(upload_ids), FileRecord.uploaded_by == user.id, scope))).scalars()}
        attached = set((await db.execute(select(MessageAttachment.file_id).where(
            MessageAttachment.kind == AttachmentKind.UPLOAD, MessageAttachment.file_id.in_(upload_ids)))).scalars())
        for upload_id in upload_ids:
            record = uploads.get(upload_id)
            if record is None:
                raise AuthError("An uploaded file was not found. Upload it again.", status_code=400)
            if upload_id in attached:
                raise AuthError("That upload was already sent in another message", status_code=409)
            rows.append(MessageAttachment(kind=AttachmentKind.UPLOAD, file_id=record.id, name=record.filename,
                                          mime_type=record.mime_type, size=record.file_size,
                                          source_workspace_id=record.workspace_id, shared_by=user.id))

    if file_ids:
        files = {f.id: f for f in (await db.execute(select(FileRecord).where(
            FileRecord.id.in_(file_ids), FileRecord.channel_id.is_(None), FileRecord.meeting_id.is_(None)))).scalars()}
        for file_id in file_ids:
            record = files.get(file_id)
            if record is None or not await _is_member(db, record.workspace_id, user.id):
                raise AuthError("A shared file was not found or you can't access it", status_code=404)
            rows.append(MessageAttachment(kind=AttachmentKind.FILE, file_id=record.id, name=record.filename,
                                          mime_type=record.mime_type, size=record.file_size,
                                          source_workspace_id=record.workspace_id, shared_by=user.id))

    if document_ids:
        docs = {d.id: d for d in (await db.execute(select(Document).where(Document.id.in_(document_ids)))).scalars()}
        for document_id in document_ids:
            doc = docs.get(document_id)
            if doc is None or not await _is_member(db, doc.workspace_id, user.id):
                raise AuthError("A shared page was not found or you can't access it", status_code=404)
            rows.append(MessageAttachment(kind=AttachmentKind.DOCUMENT, document_id=doc.id, name=doc.title[:255],
                                          mime_type="text/markdown", source_workspace_id=doc.workspace_id,
                                          shared_by=user.id))

    for position, row in enumerate(rows):
        row.position = position
    return rows


def serialize(att: MessageAttachment) -> dict:
    available = att.document_id is not None if att.kind == AttachmentKind.DOCUMENT else att.file_id is not None
    return {
        "id": str(att.id),
        "kind": att.kind,
        "name": att.name,
        "mime_type": att.mime_type,
        "size": att.size,
        "file_id": str(att.file_id) if att.file_id else None,
        "document_id": str(att.document_id) if att.document_id else None,
        "workspace_id": str(att.source_workspace_id) if att.source_workspace_id else None,
        # False when the original was deleted (shared references keep the name so it still reads).
        "available": available,
    }


async def file_for_viewer(db: AsyncSession, att: MessageAttachment, user: User) -> FileRecord:
    """The stored file behind an attachment, if this person may open it. The caller has already
    checked that they can read the conversation the attachment is in."""
    if att.kind == AttachmentKind.DOCUMENT:
        raise AuthError("This is a page: open it in Docs", status_code=400)
    record = await db.get(FileRecord, att.file_id) if att.file_id else None
    if record is None:
        raise AuthError("This file was deleted or moved and is no longer available", status_code=410)
    if att.kind == AttachmentKind.FILE and not await _is_member(db, record.workspace_id, user.id):
        sharer = await db.get(User, att.shared_by) if att.shared_by else None
        who = sharer.name if sharer else "the person who shared it"
        raise AuthError(f"You don't have access to this file. It's in a workspace you're not a member of; "
                        f"ask {who} to invite you or to send you a copy.", status_code=403)
    if not await storage.exists(record.file_path):
        raise AuthError("The stored file is missing on the server", status_code=410)
    return record


async def cleanup_unsent_uploads(db: AsyncSession, now: datetime | None = None) -> int:
    """Delete chat uploads that were never sent (or whose message was deleted) after a grace period."""
    # FileRecord.created_at is written with the server's naive clock (datetime.now): compare alike.
    cutoff = (now or datetime.now()) - UNSENT_UPLOAD_TTL
    referenced = select(MessageAttachment.id).where(MessageAttachment.file_id == FileRecord.id).exists()
    orphans = (await db.execute(select(FileRecord).where(
        or_(FileRecord.channel_id.is_not(None), FileRecord.meeting_id.is_not(None)),
        FileRecord.created_at < cutoff,
        ~referenced,
    ))).scalars().all()
    for record in orphans:
        delete_stored_file(record.file_path)
        await db.delete(record)
    await db.flush()
    return len(orphans)


def library_only():
    """Filter for the workspace Files library: files sent in a conversation are not library files."""
    return and_(FileRecord.channel_id.is_(None), FileRecord.meeting_id.is_(None))
