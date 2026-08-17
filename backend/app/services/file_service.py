import os
import uuid
from pathlib import Path
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FileRecord, User
from app.services.auth_service import AuthError
from app.services.workspace_service import get_workspace_membership

UPLOAD_DIR = Path("uploads")


async def upload_file(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    file: UploadFile,
) -> FileRecord:
    await _require_workspace_access(db, workspace_id, user.id)

    target_dir = UPLOAD_DIR / str(workspace_id)
    target_dir.mkdir(parents=True, exist_ok=True)

    file_uuid = uuid.uuid4()
    original_filename = file.filename or "unnamed_file"
    file_extension = Path(original_filename).suffix
    saved_filename = f"{file_uuid}{file_extension}"
    target_path = target_dir / saved_filename

    content = await file.read()
    file_size = len(content)

    with open(target_path, "wb") as f:
        f.write(content)

    record = FileRecord(
        id=file_uuid,
        workspace_id=workspace_id,
        filename=original_filename,
        file_path=str(target_path),
        file_size=file_size,
        mime_type=file.content_type or "application/octet-stream",
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
    if os.path.exists(record.file_path):
        try:
            os.remove(record.file_path)
        except OSError:
            pass
    await db.delete(record)
    await db.flush()


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)
