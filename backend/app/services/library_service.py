"""One library for Docs: pages and uploaded files are the same items.

Uploading a Word, PDF, Markdown or text file anywhere (the Pages import button or the Files tab)
stores the original *and* creates an editable page linked to it (`FileRecord.document_id`). The
page is what people and the copilot edit; previews and Word downloads come from the page, so they
always show the latest saved content. Other files (images, audio, archives…) stay plain files.
"""

from pathlib import Path
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Document, FileRecord, User
from app.schemas.document import DocumentContent, DocumentCreate
from app.services import storage
from app.services.auth_service import AuthError
from app.services.document_import import DOCX_MEDIA_LINK, MAX_IMPORT_BYTES, docx_media, file_to_markdown
from app.services.document_service import create_document, get_document
from app.services.file_service import get_file_record, store_bytes, upload_file
from app.services.upload_utils import delete_stored_file

PAGE_EXTENSIONS = {".docx", ".pdf", ".md", ".markdown", ".txt"}


def becomes_page(filename: str) -> bool:
    return Path(filename).suffix.lower() in PAGE_EXTENSIONS


async def _read(record: FileRecord) -> bytes:
    if (record.file_size or 0) > MAX_IMPORT_BYTES:
        raise AuthError(f"File is too large to turn into a page (limit {MAX_IMPORT_BYTES // (1024 * 1024)} MB)", status_code=413)
    if not await storage.exists(record.file_path):
        raise AuthError("Stored file is missing", status_code=404)
    async with storage.local_copy(record.file_path) as local_path:
        return Path(local_path).read_bytes()


async def _page_for(db: AsyncSession, workspace_id: UUID, user: User, record: FileRecord,
                    parent_id: UUID | None = None) -> Document:
    data = await _read(record)
    text = file_to_markdown(record.filename, data)
    title = (record.filename.rsplit(".", 1)[0] or "Imported document")[:255]
    text = await _store_docx_pictures(db, workspace_id, user, title, data, text)
    document = await create_document(
        db, workspace_id, user,
        DocumentCreate(title=title, content=DocumentContent(text=text), parent_id=parent_id, icon="📄"),
    )
    record.document_id = document.id
    await db.flush()
    return document


PICTURE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
                 ".webp": "image/webp", ".bmp": "image/bmp"}


async def _store_docx_pictures(db: AsyncSession, workspace_id: UUID, user: User, title: str, data: bytes, text: str) -> str:
    """Save each picture of an imported Word file as a workspace image and point the page at it."""
    stored: dict[str, str] = {}
    for match in DOCX_MEDIA_LINK.finditer(text):
        path = match.group(2)
        if path in stored:
            continue
        suffix = Path(path).suffix.lower()
        picture = docx_media(data, path) if suffix in PICTURE_TYPES else None
        if picture is None:
            stored[path] = ""
            continue
        record = await store_bytes(db, workspace_id, user, f"{title} - {Path(path).name}", picture, PICTURE_TYPES[suffix])
        stored[path] = str(record.id)

    def swap(match) -> str:
        file_id = stored.get(match.group(2))
        return f"![{match.group(1)}](file:{file_id})" if file_id else f"*[image: {match.group(1)}]*"

    return DOCX_MEDIA_LINK.sub(swap, text)


async def add_upload(
    db: AsyncSession,
    workspace_id: UUID,
    user: User,
    upload: UploadFile,
    parent_id: UUID | None = None,
    require_page: bool = False,
) -> tuple[FileRecord, Document | None, str | None]:
    """Store an upload; make a linked page when it's a document.

    Returns (file, page or None, why no page was made). With `require_page` (the Pages import
    button) a file that can't become a page is rejected and not kept.
    """
    filename = upload.filename or ""
    if require_page and not becomes_page(filename):
        if Path(filename).suffix.lower() == ".doc":
            raise AuthError("Old .doc files can't be imported. Save it as .docx or PDF and try again.", status_code=415)
        raise AuthError("Pages can be made from .docx, .pdf, .md and .txt files", status_code=415)

    record = await upload_file(db, workspace_id, user, upload)
    if not becomes_page(record.filename):
        return record, None, None
    try:
        document = await _page_for(db, workspace_id, user, record, parent_id)
    except AuthError as exc:
        if require_page:
            delete_stored_file(record.file_path)
            await db.delete(record)
            await db.flush()
            raise
        return record, None, exc.message
    return record, document, None


async def page_from_file(db: AsyncSession, workspace_id: UUID, user: User, file_id: UUID) -> Document:
    """The page for an uploaded file, creating and linking it the first time."""
    record = await get_file_record(db, workspace_id, file_id, user.id)
    if record.document_id:
        return await get_document(db, workspace_id, record.document_id, user.id)
    if not becomes_page(record.filename):
        raise AuthError("Pages can be made from .docx, .pdf, .md and .txt files", status_code=415)
    return await _page_for(db, workspace_id, user, record)


async def originals_for_documents(db: AsyncSession, document_ids: list[UUID]) -> list[FileRecord]:
    if not document_ids:
        return []
    return list((await db.execute(select(FileRecord).where(FileRecord.document_id.in_(document_ids)))).scalars().all())
