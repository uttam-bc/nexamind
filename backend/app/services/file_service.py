import uuid
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FileRecord, User
from app.config import get_settings
from app.services.auth_service import AuthError
from app.services.upload_utils import (
    delete_stored_file,
    safe_content_type,
    safe_extension,
    sanitize_filename,
    save_upload,
    upload_root,
)
from app.services.workspace_service import get_workspace_membership


async def upload_file(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    file: UploadFile,
) -> FileRecord:
    await _require_workspace_access(db, workspace_id, user.id)

    file_uuid = uuid.uuid4()
    original_filename = sanitize_filename(file.filename, fallback="unnamed_file")
    target_path = upload_root() / "files" / str(workspace_id) / f"{file_uuid}{safe_extension(original_filename)}"
    file_size = await save_upload(file, target_path, get_settings().max_upload_mb * 1024 * 1024)

    record = FileRecord(
        id=file_uuid,
        workspace_id=workspace_id,
        filename=original_filename,
        file_path=str(target_path),
        file_size=file_size,
        mime_type=safe_content_type(file.content_type),
        uploaded_by=user.id,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)
    return record


async def list_files(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> list[FileRecord]:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(FileRecord)
        .where(FileRecord.workspace_id == workspace_id)
        .order_by(FileRecord.created_at.desc())
    )
    return list(result.scalars().all())


async def get_file_record(
    db: AsyncSession,
    workspace_id: UUID,
    file_id: UUID,
    user_id: UUID,
) -> FileRecord:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(FileRecord).where(
            FileRecord.id == file_id,
            FileRecord.workspace_id == workspace_id,
        )
    )
    record = result.scalar_one_or_none()
    if not record:
        raise AuthError("File not found", status_code=404)
    return record


async def delete_file(
    db: AsyncSession,
    workspace_id: UUID,
    file_id: UUID,
    user_id: UUID,
) -> None:
    record = await get_file_record(db, workspace_id, file_id, user_id)
    await db.delete(record)
    await db.flush()
    delete_stored_file(record.file_path)
    await db.flush()


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
