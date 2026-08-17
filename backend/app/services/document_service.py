from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, User
from app.schemas.document import DocumentContent, DocumentCreate, DocumentUpdate
from app.services.auth_service import AuthError
from app.services.workspace_service import get_workspace_membership

DEFAULT_DOCUMENT_CONTENT = {"blocks": []}


async def list_documents(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> list[Document]:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(Document)
        .where(Document.workspace_id == workspace_id)
        .order_by(Document.updated_at.desc())
    )
    return list(result.scalars().all())


async def get_document(
    db: AsyncSession,
    workspace_id: UUID,
    document_id: UUID,
    user_id: UUID,
) -> Document:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(Document).where(
            Document.id == document_id,
            Document.workspace_id == workspace_id,
        )
    )
    document = result.scalar_one_or_none()
    if not document:
        raise AuthError("Document not found", status_code=404)
    return document


async def create_document(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    data: DocumentCreate,
) -> Document:
    await _require_workspace_access(db, workspace_id, user.id)
    content = _serialize_content(data.content)
    document = Document(
        workspace_id=workspace_id,
        title=data.title.strip(),
        content=content,
        created_by=user.id,
    )
    db.add(document)
    await db.flush()
    await db.refresh(document)
    return document


async def update_document(
    db: AsyncSession,
    workspace_id: UUID,
    document_id: UUID,
    user_id: UUID,
    data: DocumentUpdate,
) -> Document:
    if data.title is None and data.content is None:
        raise AuthError("At least one of title or content must be provided", status_code=400)

    document = await get_document(db, workspace_id, document_id, user_id)
    if data.title is not None:
        document.title = data.title.strip()
    if data.content is not None:
        document.content = _serialize_content(data.content)
    await db.flush()
    await db.refresh(document)
    return document


async def delete_document(
    db: AsyncSession,
    workspace_id: UUID,
    document_id: UUID,
    user_id: UUID,
) -> None:
    document = await get_document(db, workspace_id, document_id, user_id)
    await db.delete(document)
    await db.flush()


async def _require_workspace_access(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> None:
    membership = await get_workspace_membership(db, workspace_id, user_id)
    if not membership:
        raise AuthError("Workspace not found or access denied", status_code=404)


def _serialize_content(content: DocumentContent | None) -> dict:
    if content is None:
        return DEFAULT_DOCUMENT_CONTENT.copy()
    return content.model_dump()
