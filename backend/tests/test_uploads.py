"""Uploads keep the original bytes, are checked against their declared type, and stay private."""

import hashlib
import struct
import zlib

import pytest
from httpx import AsyncClient

from tests.conftest import auth_headers


def _png(width: int = 3, height: int = 2) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


MINIMAL_PDF = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
               b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")


@pytest.mark.asyncio
@pytest.mark.parametrize("name,data,sent_type,expected_type", [
    ("photo.png", _png(), "application/octet-stream", "image/png"),
    ("report.pdf", MINIMAL_PDF, "application/octet-stream", "application/pdf"),
])
async def test_original_bytes_are_kept_and_type_comes_from_content(client: AsyncClient, auth_context: dict, name, data,
                                                                    sent_type, expected_type) -> None:
    headers = auth_headers(auth_context["token"])
    base = f"/workspaces/{auth_context['workspace_id']}/files"
    up = await client.post(base, headers=headers, files={"file": (name, data, sent_type)})
    assert up.status_code == 201, up.text
    assert up.json()["mime_type"] == expected_type and up.json()["file_size"] == len(data)
    down = await client.get(f"{base}/{up.json()['id']}/download", headers=headers)
    assert hashlib.sha256(down.content).hexdigest() == hashlib.sha256(data).hexdigest()
    assert "attachment" in down.headers["content-disposition"]


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["slides.pdf", "photo.jpg", "image.png", "pic.webp"])
async def test_renamed_or_corrupt_files_are_refused(client: AsyncClient, auth_context: dict, name) -> None:
    headers = auth_headers(auth_context["token"])
    base = f"/workspaces/{auth_context['workspace_id']}/files"
    bad = await client.post(base, headers=headers, files={"file": (name, b"this is really a text file", "application/octet-stream")})
    assert bad.status_code == 415
    assert "isn't a valid" in bad.json()["detail"]
    assert (await client.get(base, headers=headers)).json() == []  # nothing half-saved


@pytest.mark.asyncio
async def test_other_members_workspaces_cannot_read_files(client: AsyncClient, auth_context: dict) -> None:
    headers = auth_headers(auth_context["token"])
    up = await client.post(f"/workspaces/{auth_context['workspace_id']}/files", headers=headers,
                           files={"file": ("photo.png", _png(), "image/png")})
    other = await client.post("/auth/register", json={"email": "other@example.com", "password": "securepass123", "name": "Other"})
    oh = auth_headers(other.json()["access_token"])
    resp = await client.get(f"/workspaces/{auth_context['workspace_id']}/files/{up.json()['id']}/download", headers=oh)
    assert resp.status_code in (403, 404)
