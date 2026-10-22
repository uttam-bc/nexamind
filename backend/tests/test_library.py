"""Docs library: one item per page, Word export of the latest content, and pictures in pages."""

import io
import struct
import zipfile
import zlib
from xml.etree import ElementTree

import pytest
from httpx import AsyncClient

from app.services.document_import import docx_to_markdown

from .conftest import auth_headers


def _png(width: int = 4, height: int = 2) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))
    return (bytes([0x89]) + b"PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


async def _upload(client, ctx, name, data, mime):
    resp = await client.post(f"/workspaces/{ctx['workspace_id']}/files", headers=auth_headers(ctx["token"]),
                             files={"file": (name, data, mime)})
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_word_export_reflects_the_latest_edit_and_embeds_images(client: AsyncClient, auth_context: dict) -> None:
    ws, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    logo = await _upload(client, auth_context, "logo.png", _png(400, 200), "image/png")
    body = (
        "# Roadmap\n\nWe ship on **Friday** with *care*.\n\n- First\n- Second\n\n"
        "| Owner | Task |\n| --- | --- |\n| Sam | QA |\n\n"
        f"![Company logo](file:{logo['id']})\n\n[Docs](https://example.com)"
    )
    doc = (await client.post(f"/workspaces/{ws}/documents", headers=headers,
                             json={"title": "Plan", "content": {"text": body}})).json()
    # Edit after creation: the export must show the edit.
    edited = await client.patch(f"/workspaces/{ws}/documents/{doc['id']}", headers=headers,
                                json={"content": {"text": body.replace("Sam", "Alex") + "\n\n1. Plan\n2. Build"}})
    assert edited.status_code == 200

    resp = await client.get(f"/workspaces/{ws}/documents/{doc['id']}/export?format=docx", headers=headers)
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("attachment;")
    with zipfile.ZipFile(io.BytesIO(resp.content)) as archive:
        names = archive.namelist()
        for part in names:
            if part.endswith(".xml") or part.endswith(".rels"):
                ElementTree.fromstring(archive.read(part))  # every XML part is well-formed
        assert "word/media/image1.png" in names
        assert archive.read("word/media/image1.png") == _png(400, 200)
        document_xml = archive.read("word/document.xml").decode()
    assert 'cx="3810000"' in document_xml  # 400 px at 96 dpi, under the 6-inch cap

    # Reading the export back gives the same structure.
    text = docx_to_markdown(resp.content)
    assert "# Roadmap" in text and "We ship on **Friday** with *care*." in text
    assert "- First\n- Second" in text  # real Word lists, read back as lists
    assert "| **Owner** | **Task** |" in text and "| Alex | QA |" in text and "Sam" not in text
    assert "![Company logo](docx-media:word/media/image1.png)" in text

    md = await client.get(f"/workspaces/{ws}/documents/{doc['id']}/export?format=md", headers=headers)
    assert md.status_code == 200 and "| Alex | QA |" in md.text


@pytest.mark.asyncio
async def test_pictures_in_an_imported_word_file_are_kept(client: AsyncClient, auth_context: dict) -> None:
    ws, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    picture = _png(10, 10)
    doc_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>'
        '<w:p><w:r><w:t>Before the chart</w:t></w:r></w:p>'
        '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="Sales chart"/>'
        '<a:graphic><a:graphicData><a:blip r:embed="rId7"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
        '</w:body></w:document>'
    )
    rels = ('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" '
            'Target="media/image1.png"/></Relationships>')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", doc_xml)
        archive.writestr("word/_rels/document.xml.rels", rels)
        archive.writestr("word/media/image1.png", picture)

    page = (await client.post(f"/workspaces/{ws}/documents/import", headers=headers,
                              files={"file": ("Sales.docx", buffer.getvalue(), "application/octet-stream")})).json()
    text = page["content"]["text"]
    assert text.startswith("Before the chart")
    files = (await client.get(f"/workspaces/{ws}/files", headers=headers)).json()
    image = next(f for f in files if f["filename"].endswith("image1.png"))
    assert f"![Sales chart](file:{image['id']})" in text
    stored = await client.get(f"/workspaces/{ws}/files/{image['id']}/download", headers=headers)
    assert stored.content == picture


def test_migration_links_existing_upload_and_page_pairs(tmp_path) -> None:
    """Revision 010 links an old upload to the page made from it, and leaves ambiguous ones alone."""
    import os
    import sqlite3
    from contextlib import closing
    import subprocess
    import sys
    import uuid
    from pathlib import Path

    backend = Path(__file__).resolve().parent.parent
    db_file = tmp_path / "old.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{db_file.as_posix()}"}

    def alembic(*args):
        result = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=backend, env=env,
                                capture_output=True, text=True, timeout=300)
        assert result.returncode == 0, result.stderr[-1500:]

    alembic("upgrade", "009_token_revocation_and_contact")
    hexid = lambda: uuid.uuid4().hex  # noqa: E731 - SQLAlchemy stores UUIDs as 32-char hex on SQLite
    user, ws = hexid(), hexid()
    paired_file, paired_doc = hexid(), hexid()
    dup_file, dup_doc_a, dup_doc_b = hexid(), hexid(), hexid()
    with closing(sqlite3.connect(db_file)) as conn, conn:
        conn.execute("INSERT INTO users (id, email, password_hash, name) VALUES (?, 'u@x.io', 'h', 'U')", (user,))
        conn.execute("INSERT INTO workspaces (id, name, type, owner_id) VALUES (?, 'W', 'PERSONAL', ?)", (ws, user))
        file_sql = ("INSERT INTO files (id, workspace_id, filename, file_path, file_size, mime_type, uploaded_by, created_at) "
                    "VALUES (?, ?, ?, 'x', 1, 'application/pdf', ?, '2026-10-22 10:00:00')")
        doc_sql = ("INSERT INTO documents (id, workspace_id, title, content, created_by, created_at, updated_at) "
                   "VALUES (?, ?, ?, '{}', ?, '2026-10-22 10:05:00', '2026-10-22 10:05:00')")
        conn.execute(file_sql, (paired_file, ws, "pc report.pdf", user))
        conn.execute(doc_sql, (paired_doc, ws, "pc report", user))
        conn.execute(file_sql, (dup_file, ws, "notes.md", user))
        conn.execute(doc_sql, (dup_doc_a, ws, "notes", user))
        conn.execute(doc_sql, (dup_doc_b, ws, "notes", user))

    alembic("upgrade", "head")
    with closing(sqlite3.connect(db_file)) as conn:
        links = dict(conn.execute("SELECT id, document_id FROM files").fetchall())
    assert links[paired_file] == paired_doc
    assert links[dup_file] is None  # two pages called "notes": not guessed
