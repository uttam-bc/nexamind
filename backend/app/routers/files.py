from uuid import UUID

from fastapi import APIRouter, Depends, File, Response, UploadFile, status
from fastapi.responses import FileResponse as FastAPIFileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.file import FileResponse
from app.services.file_service import (
    delete_file,
    get_file_record,
    list_files,
    upload_file,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/files", tags=["files"])


@router.get("", response_model=list[FileResponse])
async def get_workspace_files(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FileResponse]:
    records = await list_files(db, workspace_id, current_user.id)
    return [FileResponse.model_validate(rec) for rec in records]


@router.post("/upload", response_model=FileResponse, status_code=status.HTTP_201_CREATED)
async def upload_workspace_file(
    workspace_id: UUID,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    record = await upload_file(db, workspace_id, current_user, file)
    return FileResponse.model_validate(record)


@router.get("/{file_id}", response_model=FileResponse)
async def get_workspace_file_metadata(
    workspace_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    record = await get_file_record(db, workspace_id, file_id, current_user.id)
    return FileResponse.model_validate(record)


@router.get("/{file_id}/download")
async def download_workspace_file(
    workspace_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FastAPIFileResponse:
    record = await get_file_record(db, workspace_id, file_id, current_user.id)
    return FastAPIFileResponse(
        path=record.file_path,
        filename=record.filename,
        media_type=record.mime_type,
    )


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_file(
    workspace_id: UUID,
    file_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_file(db, workspace_id, file_id, current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
