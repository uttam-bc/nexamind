"""NX-REL-002: uploads can live in an S3-compatible bucket instead of the instance's disk.

There are no real bucket credentials in the test environment, so S3 is replaced by an in-memory
fake with the same calls boto3 makes (upload_file, head_object, get_object, delete_object,
download_file). Behaviour against a real provider still needs checking on staging.
"""

import io
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.config import get_settings
from app.services import storage

from .conftest import auth_headers


class FakeS3:
    def __init__(self):
        self.objects: dict[tuple[str, str], bytes] = {}

    def upload_file(self, filename, bucket, key, ExtraArgs=None):
        self.objects[(bucket, key)] = Path(filename).read_bytes()

    def head_object(self, Bucket, Key):
        if (Bucket, Key) not in self.objects:
            raise KeyError(Key)
        return {}

    def get_object(self, Bucket, Key):
        return {"Body": io.BytesIO(self.objects[(Bucket, Key)])}

    def delete_object(self, Bucket, Key):
        self.objects.pop((Bucket, Key), None)

    def download_file(self, bucket, key, filename):
        Path(filename).write_bytes(self.objects[(bucket, key)])


@pytest.fixture
def fake_s3(monkeypatch):
    fake = FakeS3()
    monkeypatch.setattr(get_settings(), "storage_backend", "s3")
    monkeypatch.setattr(get_settings(), "s3_bucket", "nexamind-test")
    monkeypatch.setattr(storage, "_client", lambda: fake)
    return fake


@pytest.mark.asyncio
async def test_file_upload_download_delete_through_bucket(client: AsyncClient, auth_context: dict, fake_s3) -> None:
    ws, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    resp = await client.post(f"/workspaces/{ws}/files", headers=headers,
                             files={"file": ("report.txt", b"quarterly numbers", "text/plain")})
    assert resp.status_code == 201, resp.text
    file_id = resp.json()["id"]
    assert list(fake_s3.objects.values()) == [b"quarterly numbers"]
    # No copy is left on the instance's disk.
    assert not any(Path(get_settings().upload_dir, "files", ws).glob("*"))

    download = await client.get(f"/workspaces/{ws}/files/{file_id}/download", headers=headers)
    assert download.status_code == 200
    assert download.content == b"quarterly numbers"
    assert download.headers["content-disposition"].startswith("attachment;")

    assert (await client.delete(f"/workspaces/{ws}/files/{file_id}", headers=headers)).status_code == 204
    assert fake_s3.objects == {}


@pytest.mark.asyncio
async def test_bucket_failure_is_reported_not_silently_lost(client: AsyncClient, auth_context: dict, fake_s3, monkeypatch) -> None:
    def broken(*_a, **_k):
        raise ConnectionError("bucket unreachable")

    monkeypatch.setattr(fake_s3, "upload_file", broken)
    ws, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    resp = await client.post(f"/workspaces/{ws}/files", headers=headers, files={"file": ("a.txt", b"x", "text/plain")})
    assert resp.status_code == 503
    assert (await client.get(f"/workspaces/{ws}/files", headers=headers)).json() == []


@pytest.mark.asyncio
async def test_recordings_fetch_a_local_copy_for_transcription(fake_s3) -> None:
    fake_s3.objects[("nexamind-test", "sessions/w/rec.webm")] = b"audio-bytes"
    path = "s3://nexamind-test/sessions/w/rec.webm"
    assert await storage.exists(path)
    async with storage.local_copy(path) as local:
        assert Path(local).read_bytes() == b"audio-bytes"
    assert not Path(local).exists()  # temp copy cleaned up


@pytest.mark.asyncio
async def test_local_backend_unchanged(client: AsyncClient, auth_context: dict) -> None:
    ws, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    resp = await client.post(f"/workspaces/{ws}/files", headers=headers, files={"file": ("n.txt", b"local", "text/plain")})
    assert resp.status_code == 201
    download = await client.get(f"/workspaces/{ws}/files/{resp.json()['id']}/download", headers=headers)
    assert download.content == b"local"


def test_error_reports_are_scrubbed() -> None:
    from app.monitoring import init_monitoring, scrub_event

    event = {"request": {"headers": {"Authorization": "Bearer abc", "User-Agent": "x"},
                         "data": {"password": "hunter2"}, "cookies": {"s": "1"}}, "user": {"email": "a@b.c"}}
    cleaned = scrub_event(event)
    assert cleaned["request"]["headers"] == {"Authorization": "[removed]", "User-Agent": "x"}
    assert "data" not in cleaned["request"] and "cookies" not in cleaned["request"] and "user" not in cleaned
    assert init_monitoring(None, "test") is False
