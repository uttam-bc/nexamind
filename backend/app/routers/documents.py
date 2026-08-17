from uuid import UUID

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.document import (
    DocumentCreate,
    DocumentListItem,
    DocumentResponse,
    DocumentUpdate,
)
from app.services.document_service import (
    create_document,
    delete_document,
    get_document,
    list_documents,
    update_document,
)

router = APIRouter(prefix="/workspaces/{workspace_id}/documents", tags=["documents"])


@router.get("", response_model=list[DocumentListItem])
async def get_documents(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DocumentListItem]:
    documents = await list_documents(db, workspace_id, current_user.id)
    return [DocumentListItem.model_validate(document) for document in documents]


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace_document(
    workspace_id: UUID,
    data: DocumentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentResponse:
    document = await create_document(db, workspace_id, current_user, data)
    return DocumentResponse.model_validate(document)


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_workspace_document(
    workspace_id: UUID,
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentResponse:
    document = await get_document(db, workspace_id, document_id, current_user.id)
    return DocumentResponse.model_validate(document)


@router.patch("/{document_id}", response_model=DocumentResponse)
async def update_workspace_document(
    workspace_id: UUID,
    document_id: UUID,
    data: DocumentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentResponse:
    document = await update_document(db, workspace_id, document_id, current_user.id, data)
    return DocumentResponse.model_validate(document)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_document(
    workspace_id: UUID,
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await delete_document(db, workspace_id, document_id, current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
