from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, FileRecord, User
from app.schemas.document import DocumentContent, DocumentCreate, DocumentUpdate
from app.services.auth_service import AuthError
from app.services.upload_utils import delete_stored_file
from app.services.workspace_service import get_workspace_membership, require_author_or_manager

DEFAULT_DOCUMENT_CONTENT = {"blocks": []}


async def list_documents(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    limit: int | None = None,
    offset: int = 0,
) -> list[Document]:
    await _require_workspace_access(db, workspace_id, user_id)
    result = await db.execute(
        select(Document)
        .where(Document.workspace_id == workspace_id)
        .order_by(Document.updated_at.desc())
        .limit(limit)
        .offset(offset)
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
    if data.parent_id:
        parent = await get_document(db, workspace_id, data.parent_id, user.id)
        if not parent:
            raise AuthError("Parent document not found", status_code=404)

    content = _serialize_content(data.content)
    document = Document(
        workspace_id=workspace_id,
        title=data.title.strip(),
        content=content,
        created_by=user.id,
        parent_id=data.parent_id,
        icon=data.icon or "📄",
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
    if (
        data.title is None
        and data.content is None
        and data.parent_id is None
        and data.icon is None
    ):
        raise AuthError("At least one field must be provided to update", status_code=400)

    document = await get_document(db, workspace_id, document_id, user_id)
    if data.title is not None:
        document.title = data.title.strip()
    if data.content is not None:
        document.content = _serialize_content(data.content)
    if data.icon is not None:
        document.icon = data.icon
    if data.parent_id is not None:
        # Walk up from the new parent; reaching this document would create a cycle.
        ancestor_id: UUID | None = data.parent_id
        for _ in range(1000):
            if ancestor_id is None:
                break
            if ancestor_id == document_id:
                raise AuthError("A page cannot be moved inside itself or one of its sub-pages", status_code=400)
            ancestor = await get_document(db, workspace_id, ancestor_id, user_id)
            ancestor_id = ancestor.parent_id
        document.parent_id = data.parent_id

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
    await require_author_or_manager(db, document.workspace_id, user_id, document.created_by)

    # Sub-pages go with the page; so do the original uploads linked to any of them.
    subtree = [document.id]
    frontier = [document.id]
    while frontier:
        children = (await db.execute(select(Document.id).where(Document.parent_id.in_(frontier)))).scalars().all()
        frontier = [c for c in children if c not in subtree]
        subtree.extend(frontier)
    originals = (await db.execute(select(FileRecord).where(FileRecord.document_id.in_(subtree)))).scalars().all()
    stored_paths = [f.file_path for f in originals]
    for record in originals:
        await db.delete(record)
    await db.flush()  # before the page, so the database cascade has nothing left to remove
    await db.delete(document)
    await db.flush()
    for path in stored_paths:
        delete_stored_file(path)


async def search_documents(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
    query: str,
) -> list[dict]:
    await _require_workspace_access(db, workspace_id, user_id)
    q = query.strip().lower()
    if not q:
        return []

    docs = await list_documents(db, workspace_id, user_id)
    results = []
    for doc in docs:
        if q in doc.title.lower():
            results.append(
                {
                    "id": doc.id,
                    "workspace_id": doc.workspace_id,
                    "title": doc.title,
                    "icon": doc.icon or "📄",
                    "snippet": doc.title,
                    "match_type": "title",
                    "updated_at": doc.updated_at,
                }
            )
            continue

        matched, snippet = _extract_text_and_snippet(doc.content, q)
        if matched:
            results.append(
                {
                    "id": doc.id,
                    "workspace_id": doc.workspace_id,
                    "title": doc.title,
                    "icon": doc.icon or "📄",
                    "snippet": snippet,
                    "match_type": "content",
                    "updated_at": doc.updated_at,
                }
            )

    return results


async def get_document_tree(
    db: AsyncSession,
    workspace_id: UUID,
    user_id: UUID,
) -> list[dict]:
    await _require_workspace_access(db, workspace_id, user_id)
    docs = await list_documents(db, workspace_id, user_id)
    doc_map = {
        doc.id: {
            "id": doc.id,
            "parent_id": doc.parent_id,
            "title": doc.title,
            "icon": doc.icon or "📄",
            "children": [],
        }
        for doc in docs
    }

    tree = []
    for doc in docs:
        node = doc_map[doc.id]
        if doc.parent_id and doc.parent_id in doc_map:
            doc_map[doc.parent_id]["children"].append(node)
        else:
            tree.append(node)

    return tree


def _extract_text_and_snippet(content: dict, query: str) -> tuple[bool, str]:
    if not isinstance(content, dict):
        return False, ""
    blocks = content.get("blocks", [])
    q = query.lower()
    for b in blocks:
        if not isinstance(b, dict):
            continue
        text = b.get("text", "")
        if text and q in text.lower():
            idx = text.lower().find(q)
            start = max(0, idx - 40)
            end = min(len(text), idx + len(query) + 40)
            snippet = ("..." if start > 0 else "") + text[start:end] + ("..." if end < len(text) else "")
            return True, snippet
        items = b.get("items", [])
        if isinstance(items, list):
            for item in items:
                if isinstance(item, str) and q in item.lower():
                    return True, item
    return False, ""



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
