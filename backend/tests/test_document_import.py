"""Uploaded Word/PDF/text files become readable documents (not raw bytes)."""

import io
import zipfile

import pytest
from httpx import AsyncClient

from tests.conftest import auth_headers

DOCX_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Launch Plan</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">We ship on </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Friday</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Write tests</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Deploy</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Task</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Alex</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>QA</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>"""


PNG_SIGNATURE = bytes([0x89]) + b"PNG" + bytes([13, 10, 26, 10])


def _docx() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", DOCX_XML)
    return buffer.getvalue()


def _pdf(text: str) -> bytes:
    """A minimal one-page PDF with a real text layer."""
    stream = f"BT /F1 18 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{number} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return out.getvalue()


async def _import(client: AsyncClient, ctx: dict, name: str, data: bytes):
    return await client.post(
        f"/workspaces/{ctx['workspace_id']}/documents/import",
        headers=auth_headers(ctx["token"]),
        files={"file": (name, data, "application/octet-stream")},
    )


@pytest.mark.asyncio
async def test_docx_import_keeps_structure(client: AsyncClient, auth_context: dict) -> None:
    resp = await _import(client, auth_context, "Launch Plan.docx", _docx())
    assert resp.status_code == 201, resp.text
    body = resp.json()
    text = body["content"]["text"]
    assert body["title"] == "Launch Plan"
    assert text.startswith("# Launch Plan")
    assert "We ship on **Friday**" in text
    assert "- Write tests\n- Deploy" in text
    assert "| Owner | Task |" in text and "| Alex | QA |" in text
    assert "PK" not in text  # no zip bytes leaked into the document


@pytest.mark.asyncio
async def test_pdf_import_extracts_text(client: AsyncClient, auth_context: dict) -> None:
    resp = await _import(client, auth_context, "brief.pdf", _pdf("Quarterly roadmap review"))
    assert resp.status_code == 201, resp.text
    assert "Quarterly roadmap review" in resp.json()["content"]["text"]


@pytest.mark.asyncio
async def test_text_and_rejections(client: AsyncClient, auth_context: dict) -> None:
    ok = await _import(client, auth_context, "notes.md", "# Notes\n\n- one".encode())
    assert ok.status_code == 201 and ok.json()["content"]["text"] == "# Notes\n\n- one"
    assert (await _import(client, auth_context, "old.doc", b"\xd0\xcf\x11\xe0")).status_code == 415
    assert (await _import(client, auth_context, "bad.docx", b"not a zip")).status_code == 400
    assert (await _import(client, auth_context, "bad.pdf", b"%PDF-1.4 broken")).status_code in (400, 422)
    assert (await _import(client, auth_context, "app.exe", b"MZ")).status_code == 415


async def _upload(client: AsyncClient, ctx: dict, name: str, data: bytes, mime: str) -> dict:
    resp = await client.post(f"/workspaces/{ctx['workspace_id']}/files", headers=auth_headers(ctx["token"]),
                             files={"file": (name, data, mime)})
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("name,data,mime,kind,snippet", [
    ("plan.docx", None, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "markdown", "# Launch Plan"),
    ("notes.md", b"# Notes\n\n- one", "text/markdown", "markdown", "# Notes"),
    ("main.py", b"print('hi')\n", "text/x-python", "code", "print('hi')"),
    ("data.csv", b"a,b\n1,2\n", "text/csv", "text", "a,b"),
    ("brief.pdf", None, "application/pdf", "pdf", None),
    ("photo.png", b"\x89PNG\r\n\x1a\n", "image/png", "image", None),
    ("logo.svg", b"<svg onload='alert(1)'/>", "image/svg+xml", "none", None),
])
async def test_file_preview_kinds(client: AsyncClient, auth_context: dict, name, data, mime, kind, snippet) -> None:
    payload = data if data is not None else (_docx() if name.endswith(".docx") else _pdf("hello"))
    uploaded = await _upload(client, auth_context, name, payload, mime)
    resp = await client.get(f"/workspaces/{auth_context['workspace_id']}/files/{uploaded['id']}/preview",
                            headers=auth_headers(auth_context["token"]))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == kind
    if snippet:
        assert snippet in body["text"]
    else:
        assert body["text"] is None  # binary kinds are rendered by the browser, SVG never


@pytest.mark.asyncio
async def test_uploaded_document_is_one_item_with_its_page(client: AsyncClient, auth_context: dict) -> None:
    """A Word upload in Files is also the page in Pages: one item, not two copies."""
    uploaded = await _upload(client, auth_context, "Launch Plan.docx", _docx(),
                             "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    ws, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    assert uploaded["document_id"] and uploaded["page_error"] is None
    docs = (await client.get(f"/workspaces/{ws}/documents", headers=headers)).json()
    assert [d["id"] for d in docs] == [uploaded["document_id"]]

    # Asking for its page again returns the same page instead of making a copy.
    resp = await client.post(f"/workspaces/{ws}/files/{uploaded['id']}/to-document", headers=headers)
    assert resp.status_code == 200 and resp.json()["id"] == uploaded["document_id"]
    assert len((await client.get(f"/workspaces/{ws}/documents", headers=headers)).json()) == 1

    image = await _upload(client, auth_context, "photo.png", PNG_SIGNATURE, "image/png")
    assert image["document_id"] is None
    assert (await client.post(f"/workspaces/{ws}/files/{image['id']}/to-document", headers=headers)).status_code == 415


@pytest.mark.asyncio
async def test_import_keeps_the_original_and_deleting_either_removes_both(client: AsyncClient, auth_context: dict) -> None:
    ws, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    page = (await _import(client, auth_context, "Brief.docx", _docx())).json()
    files = (await client.get(f"/workspaces/{ws}/files", headers=headers)).json()
    assert [(f["filename"], f["document_id"]) for f in files] == [("Brief.docx", page["id"])]

    # Delete from the Files side: the page goes too.
    assert (await client.delete(f"/workspaces/{ws}/files/{files[0]['id']}", headers=headers)).status_code == 204
    assert (await client.get(f"/workspaces/{ws}/documents", headers=headers)).json() == []

    # Delete from the Pages side: the original goes too.
    page = (await _import(client, auth_context, "Brief.docx", _docx())).json()
    assert (await client.delete(f"/workspaces/{ws}/documents/{page['id']}", headers=headers)).status_code == 204
    assert (await client.get(f"/workspaces/{ws}/files", headers=headers)).json() == []
