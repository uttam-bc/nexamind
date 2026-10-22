from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models import User
from app.schemas.document import (
    DocumentCreate,
    DocumentListItem,
    DocumentResponse,
    DocumentSearchResult,
    DocumentTreeNode,
    DocumentUpdate,
)
from app.services.document_service import (
    create_document,
    delete_document,
    get_document,
    get_document_tree,
    list_documents,
    search_documents,
    update_document,
)
from app.services.docx_export import load_workspace_image, markdown_to_docx
from app.services.library_service import add_upload
from app.services.memory_engine import forget_source, schedule_document_ingestion
from app.services.memory_engine import extract_text_from_document
from app.services.upload_utils import sanitize_filename

router = APIRouter(prefix="/workspaces/{workspace_id}/documents", tags=["documents"])


@router.get("", response_model=list[DocumentListItem])
async def get_documents(
    workspace_id: UUID,
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[DocumentListItem]:
    documents = await list_documents(db, workspace_id, current_user.id, limit=limit, offset=offset)
    return [DocumentListItem.model_validate(document) for document in documents]


@router.get("/search", response_model=list[DocumentSearchResult])
async def search_workspace_documents(
    workspace_id: UUID,
    q: str = "",
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[DocumentSearchResult]:
    results = await search_documents(db, workspace_id, current_user.id, q)
    return [DocumentSearchResult.model_validate(r) for r in results]


@router.get("/tree", response_model=list[DocumentTreeNode])
async def get_workspace_document_tree(
    workspace_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> list[DocumentTreeNode]:
    tree = await get_document_tree(db, workspace_id, current_user.id)
    return [DocumentTreeNode.model_validate(node) for node in tree]


@router.post("", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def create_workspace_document(
    workspace_id: UUID,
    data: DocumentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> DocumentResponse:
    document = await create_document(db, workspace_id, current_user, data)
    await db.commit()
    schedule_document_ingestion(document.id)
    return DocumentResponse.model_validate(document)



@router.post("/import", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
async def import_workspace_document(
    workspace_id: UUID,
    file: UploadFile = File(...),
    parent_id: UUID | None = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> DocumentResponse:
    """Create a page from a .docx, .pdf, .md or .txt upload; the original is kept in Files."""
    _record, document, _ = await add_upload(db, workspace_id, current_user, file, parent_id=parent_id, require_page=True)
    await db.commit()
    schedule_document_ingestion(document.id)
    return DocumentResponse.model_validate(document)


@router.get("/{document_id}/export")
async def export_workspace_document(
    workspace_id: UUID,
    document_id: UUID,
    format: str = Query("docx", pattern="^(docx|md)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> Response:
    """The page as it is now, as a Word document (with its images) or Markdown."""
    document = await get_document(db, workspace_id, document_id, current_user.id)
    text = extract_text_from_document(document)
    base = sanitize_filename(document.title, fallback="document")
    if format == "md":
        data, media_type, filename = text.encode("utf-8"), "text/markdown; charset=utf-8", f"{base}.md"
    else:
        async def load_image(file_id: str) -> tuple[bytes, str] | None:
            return await load_workspace_image(db, workspace_id, current_user.id, file_id)

        data = await markdown_to_docx(text, title=document.title, load_image=load_image)
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        filename = f"{base}.docx"
    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename*=utf-8''{quote(filename)}"},
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_workspace_document(
    workspace_id: UUID,
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> DocumentResponse:
    document = await get_document(db, workspace_id, document_id, current_user.id)
    return DocumentResponse.model_validate(document)


@router.patch("/{document_id}", response_model=DocumentResponse)
async def update_workspace_document(
    workspace_id: UUID,
    document_id: UUID,
    data: DocumentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> DocumentResponse:
    document = await update_document(db, workspace_id, document_id, current_user.id, data)
    await db.commit()
    schedule_document_ingestion(document.id)
    return DocumentResponse.model_validate(document)


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace_document(
    workspace_id: UUID,
    document_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db, scope="function"),
) -> Response:
    await delete_document(db, workspace_id, document_id, current_user.id)
    await forget_source(db, workspace_id, str(document_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
