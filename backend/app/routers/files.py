from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Response, UploadFile, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.file import FileResponse, FileUploadResponse
from app.schemas.document import DocumentResponse
from app.services import storage
from app.services.document_import import preview_kind, preview_text
from app.services.library_service import add_upload, page_from_file
from app.services.memory_engine import schedule_document_ingestion
from app.services.auth_service import AuthError
from app.services.upload_utils import safe_content_type
from app.services.file_service import (
    delete_file,
    get_file_record,
    list_files,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/files", tags=["files"])


@router.get("", response_model=list[FileResponse])
async def get_workspace_files(
    workspace_id: UUID,
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[FileResponse]:
    records = await list_files(db, workspace_id, current_user.id, limit=limit, offset=offset)
    return [FileResponse.model_validate(rec) for rec in records]


@router.post("", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
@router.post("/upload", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def upload_workspace_file(
    workspace_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> FileUploadResponse:
    """Store a file. Word, PDF, Markdown and text files also become an editable page in Docs."""
    record, document, page_error = await add_upload(db, workspace_id, current_user, file)
    await db.commit()
    if document is not None:
        schedule_document_ingestion(document.id)
    return FileUploadResponse.model_validate(record).model_copy(update={"page_error": page_error})


@router.get("/{file_id}", response_model=FileResponse)
async def get_workspace_file_metadata(
    workspace_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> FileResponse:
    record = await get_file_record(db, workspace_id, file_id, current_user.id)
    return FileResponse.model_validate(record)


MAX_PREVIEW_BYTES = 15 * 1024 * 1024


@router.get("/{file_id}/preview")
async def preview_workspace_file(
    workspace_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> dict:
    """What to show in the in-app viewer. Text-like files (including Word) come back as text."""
    record = await get_file_record(db, workspace_id, file_id, current_user.id)
    kind = preview_kind(record.filename, record.mime_type)
    result = {"kind": kind, "filename": record.filename, "mime_type": record.mime_type, "text": None}
    if kind not in {"markdown", "code", "text"}:
        return result
    if (record.file_size or 0) > MAX_PREVIEW_BYTES:
        return {**result, "kind": "none", "reason": "too_large"}
    if not await storage.exists(record.file_path):
        raise AuthError("Stored file is missing", status_code=404)
    async with storage.local_copy(record.file_path) as local_path:
        data = Path(local_path).read_bytes()
    try:
        result["text"] = preview_text(record.filename, data)
    except AuthError:
        return {**result, "kind": "none", "reason": "unreadable"}
    return result


@router.post("/{file_id}/to-document", response_model=DocumentResponse, status_code=status.HTTP_200_OK)
async def save_file_as_document(
    workspace_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> DocumentResponse:
    """The editable page for an uploaded file (made and linked the first time it's asked for)."""
    document = await page_from_file(db, workspace_id, current_user, file_id)
    await db.commit()
    schedule_document_ingestion(document.id)
    return DocumentResponse.model_validate(document)


@router.get("/{file_id}/download")
async def download_workspace_file(
    workspace_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
):
    record = await get_file_record(db, workspace_id, file_id, current_user.id)
    if not await storage.exists(record.file_path):
        raise AuthError("Stored file is missing", status_code=404)
    # Always a download, never rendered inline, so uploaded HTML/SVG cannot run in our origin.
    return storage.download_response(record.file_path, record.filename, safe_content_type(record.mime_type))


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_file(
    workspace_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> Response:
    await delete_file(db, workspace_id, file_id, current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
