"""Link an uploaded file to the Docs page made from it, so both tabs show one item.

Additive: one nullable column. Existing files keep working as standalone files.

Revision ID: 010_link_files_to_documents
Revises: 009_token_revocation_and_contact
Create Date: 2026-10-23 09:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010_link_files_to_documents"
down_revision: Union[str, None] = "009_token_revocation_and_contact"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(table: str, column: str) -> bool:
    return column in [c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)]


PAGE_EXTENSIONS = (".docx", ".pdf", ".md", ".markdown", ".txt")


def _link_existing_pairs() -> None:
    """Link uploads to the pages made from them before this revision ("save as page" or import).

    Only unambiguous pairs: same workspace, page title equal to the file name without its
    extension, page created at or after the upload, and exactly one candidate on each side.
    Nothing is deleted or rewritten; unmatched files simply stay standalone.
    """
    bind = op.get_bind()
    files = bind.execute(sa.text("SELECT id, workspace_id, filename, created_at FROM files WHERE document_id IS NULL")).fetchall()
    docs = bind.execute(sa.text("SELECT id, workspace_id, title, created_at FROM documents")).fetchall()
    candidates = {}
    for f in files:
        name = f.filename or ""
        if not name.lower().endswith(PAGE_EXTENSIONS):
            continue
        stem = name.rsplit(".", 1)[0]
        matches = [d for d in docs if d.workspace_id == f.workspace_id and d.title == stem
                   and (f.created_at is None or d.created_at is None or str(d.created_at) >= str(f.created_at))]
        if len(matches) == 1:
            candidates[f.id] = matches[0].id
    claimed = {}
    for file_id, doc_id in candidates.items():
        claimed.setdefault(doc_id, []).append(file_id)
    for doc_id, file_ids in claimed.items():
        if len(file_ids) == 1:
            bind.execute(sa.text("UPDATE files SET document_id = :doc WHERE id = :file"), {"doc": doc_id, "file": file_ids[0]})


def upgrade() -> None:
    if not _column_exists("files", "document_id"):
        with op.batch_alter_table("files") as batch:
            batch.add_column(sa.Column("document_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key(
                "fk_files_document_id_documents", "documents", ["document_id"], ["id"], ondelete="CASCADE"
            )
            batch.create_index("ix_files_document_id", ["document_id"])
    _link_existing_pairs()


def downgrade() -> None:
    if _column_exists("files", "document_id"):
        with op.batch_alter_table("files") as batch:
            batch.drop_index("ix_files_document_id")
            batch.drop_constraint("fk_files_document_id_documents", type_="foreignkey")
            batch.drop_column("document_id")
