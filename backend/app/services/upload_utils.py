"""Shared helpers for storing user uploads safely."""

import re
import unicodedata
from pathlib import Path

from fastapi import UploadFile

from app.config import get_settings
from app.services.auth_service import AuthError

CHUNK_SIZE = 1024 * 1024

# Types a browser would render or execute; always served as an opaque download.
ACTIVE_CONTENT_TYPES = {
    "text/html",
    "application/xhtml+xml",
    "image/svg+xml",
    "text/xml",
    "application/xml",
    "text/javascript",
    "application/javascript",
    "application/x-javascript",
}


def upload_root() -> Path:
    return Path(get_settings().upload_dir)


def sanitize_filename(name: str | None, fallback: str = "file") -> str:
    """Keep a display-safe base name: no directories, control characters, or reserved symbols."""
    base = Path((name or "").replace("\\", "/")).name
    base = unicodedata.normalize("NFKC", base)
    base = re.sub(r"[\x00-\x1f\x7f<>:\"/\\|?*]", "_", base).strip(" .")
    if not base:
        base = fallback
    if len(base) > 200:
        stem, suffix = Path(base).stem, Path(base).suffix[:20]
        base = stem[: 200 - len(suffix)] + suffix
    return base


def safe_extension(filename: str, default: str = "") -> str:
    suffix = Path(filename).suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9]{1,10}", suffix) else default


def safe_content_type(content_type: str | None) -> str:
    value = (content_type or "").split(";")[0].strip().lower()
    if not re.fullmatch(r"[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+", value) or value in ACTIVE_CONTENT_TYPES:
        return "application/octet-stream"
    return value


async def save_upload(file: UploadFile, target_path: Path, max_bytes: int) -> int:
    """Stream an upload to disk, enforcing a size limit. Returns the number of bytes written."""
    target_path.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    try:
        with open(target_path, "wb") as out:
            while chunk := await file.read(CHUNK_SIZE):
                written += len(chunk)
                if written > max_bytes:
                    raise AuthError(
                        f"File is too large (limit {max_bytes // (1024 * 1024)} MB)",
                        status_code=413,
                    )
                out.write(chunk)
    except BaseException:
        target_path.unlink(missing_ok=True)
        raise
    if written == 0:
        target_path.unlink(missing_ok=True)
        raise AuthError("Uploaded file is empty", status_code=400)
    return written


def delete_stored_file(path: str | None) -> None:
    """Remove a stored upload, refusing anything outside the upload directory."""
    if not path:
        return
    root = upload_root().resolve()
    candidate = Path(path).resolve()
    if candidate.is_relative_to(root):
        candidate.unlink(missing_ok=True)
