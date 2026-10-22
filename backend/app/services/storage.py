"""Where uploaded files live: the local upload directory (default) or an S3-compatible bucket.

Uploads are always streamed to local disk first (size limits, sanitised names). With
STORAGE_BACKEND=s3 the file is then copied to the bucket and the local copy removed, and the
stored path becomes ``s3://<bucket>/<key>``. Records made before switching keep working, because
every operation looks at the stored path rather than the current setting.
"""

import asyncio
import contextlib
import logging
import os
import tempfile
from collections.abc import AsyncIterator, Iterator
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote

from fastapi.responses import FileResponse, StreamingResponse

from app.config import get_settings
from app.services.auth_service import AuthError

logger = logging.getLogger(__name__)
S3_PREFIX = "s3://"
STREAM_CHUNK = 1024 * 1024


def is_remote(path: str | None) -> bool:
    return bool(path) and path.startswith(S3_PREFIX)


def _split(path: str) -> tuple[str, str]:
    bucket, _, key = path[len(S3_PREFIX):].partition("/")
    return bucket, key


@lru_cache
def _client():
    import boto3

    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint_url or None,
        region_name=s.s3_region or None,
        aws_access_key_id=s.s3_access_key_id or None,
        aws_secret_access_key=s.s3_secret_access_key or None,
    )


def reset_client() -> None:
    _client.cache_clear()


async def persist_upload(local_path: Path, key: str, content_type: str | None = None) -> str:
    """Move a freshly saved upload to its permanent home; returns the path to store on the record."""
    settings = get_settings()
    if settings.storage_backend != "s3":
        return str(local_path)
    bucket = settings.s3_bucket
    extra = {"ContentType": content_type} if content_type else {}
    try:
        await asyncio.to_thread(_client().upload_file, str(local_path), bucket, key, ExtraArgs=extra or None)
    except Exception as exc:  # network/credential errors must not leave a record without its file
        logger.error("Upload to object storage failed: %s", exc.__class__.__name__)
        raise AuthError("Could not store the file right now. Please try again.", status_code=503) from exc
    finally:
        local_path.unlink(missing_ok=True)
    return f"{S3_PREFIX}{bucket}/{key}"


def delete(path: str | None, local_root: Path) -> None:
    if not path:
        return
    if is_remote(path):
        bucket, key = _split(path)
        try:
            _client().delete_object(Bucket=bucket, Key=key)
        except Exception as exc:
            logger.warning("Could not delete stored object: %s", exc.__class__.__name__)
        return
    root = local_root.resolve()
    candidate = Path(path).resolve()
    if candidate.is_relative_to(root):
        candidate.unlink(missing_ok=True)


async def exists(path: str | None) -> bool:
    if not path:
        return False
    if is_remote(path):
        bucket, key = _split(path)
        try:
            await asyncio.to_thread(_client().head_object, Bucket=bucket, Key=key)
            return True
        except Exception:
            return False
    return os.path.exists(path)


@contextlib.asynccontextmanager
async def local_copy(path: str, suffix: str = "") -> AsyncIterator[str]:
    """A local file path for processing (e.g. transcription); remote files are fetched to a temp file."""
    if not is_remote(path):
        yield path
        return
    bucket, key = _split(path)
    handle, temp_path = tempfile.mkstemp(suffix=suffix or Path(key).suffix)
    os.close(handle)
    try:
        await asyncio.to_thread(_client().download_file, bucket, key, temp_path)
        yield temp_path
    finally:
        Path(temp_path).unlink(missing_ok=True)


def download_response(path: str, filename: str, media_type: str):
    """Always an attachment, never rendered inline, so uploaded HTML/SVG can't run in our origin."""
    if not is_remote(path):
        return FileResponse(path=path, filename=filename, media_type=media_type, content_disposition_type="attachment")
    bucket, key = _split(path)
    body = _client().get_object(Bucket=bucket, Key=key)["Body"]

    def chunks() -> Iterator[bytes]:
        try:
            while chunk := body.read(STREAM_CHUNK):
                yield chunk
        finally:
            body.close()

    ascii_name = filename.encode("ascii", "ignore").decode().replace('"', "") or "download"
    disposition = f"attachment; filename=\"{ascii_name}\"; filename*=utf-8''{quote(filename)}"
    return StreamingResponse(chunks(), media_type=media_type, headers={"Content-Disposition": disposition})
