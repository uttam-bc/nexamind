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


# File signatures of the formats the app shows inline. A file named .pdf/.jpg/... must really be
# one, so a renamed or truncated upload is refused with a clear message instead of a broken preview.
SIGNATURES = {
    ".pdf": ("application/pdf", lambda h: h.startswith(b"%PDF-")),
    ".png": ("image/png", lambda h: h.startswith(bytes.fromhex("89504e470d0a1a0a"))),
    ".jpg": ("image/jpeg", lambda h: h.startswith(bytes.fromhex("ffd8ff"))),
    ".jpeg": ("image/jpeg", lambda h: h.startswith(bytes.fromhex("ffd8ff"))),
    ".gif": ("image/gif", lambda h: h[:6] in (b"GIF87a", b"GIF89a")),
    ".webp": ("image/webp", lambda h: h[:4] == b"RIFF" and h[8:12] == b"WEBP"),
    ".bmp": ("image/bmp", lambda h: h.startswith(b"BM")),
}


def verify_signature(path: Path, filename: str) -> str | None:
    """The real content type for formats we render, or None for others. Raises on a mismatch."""
    expected = SIGNATURES.get(Path(filename).suffix.lower())
    if expected is None:
        return None
    with open(path, "rb") as handle:
        head = handle.read(16)
    mime, matches = expected
    if not matches(head):
        raise AuthError(
            f"“{filename}” isn't a valid {Path(filename).suffix.lower()[1:].upper()} file "
            "(it may be damaged, incomplete or renamed). Nothing was saved.",
            status_code=415,
        )
    return mime


# What can be sent in chat, by extension, and how its content is checked. Anything else is refused.
OFFICE_ZIP = {".docx": "word/", ".xlsx": "xl/", ".pptx": "ppt/"}
OFFICE_OLE = {".doc": "application/msword", ".xls": "application/vnd.ms-excel", ".ppt": "application/vnd.ms-powerpoint"}
OFFICE_ZIP_TYPES = {
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
TEXT_TYPES = {
    ".txt": "text/plain", ".md": "text/markdown", ".markdown": "text/markdown", ".csv": "text/csv", ".tsv": "text/tab-separated-values",
    ".json": "application/json", ".yaml": "text/yaml", ".yml": "text/yaml", ".toml": "text/plain", ".ini": "text/plain",
    ".cfg": "text/plain", ".log": "text/plain", ".xml": "text/plain", ".sql": "text/plain", ".env.example": "text/plain",
    ".py": "text/x-python", ".js": "text/javascript", ".jsx": "text/javascript", ".mjs": "text/javascript", ".ts": "text/plain",
    ".tsx": "text/plain", ".java": "text/plain", ".kt": "text/plain", ".c": "text/plain", ".h": "text/plain", ".cpp": "text/plain",
    ".hpp": "text/plain", ".cs": "text/plain", ".go": "text/plain", ".rs": "text/plain", ".rb": "text/plain", ".php": "text/plain",
    ".swift": "text/plain", ".sh": "text/plain", ".ps1": "text/plain", ".html": "text/plain", ".css": "text/css",
    ".scss": "text/plain", ".vue": "text/plain", ".svelte": "text/plain", ".dart": "text/plain", ".r": "text/plain",
}
ALLOWED_CHAT_EXTENSIONS = sorted({*SIGNATURES, *OFFICE_ZIP, *OFFICE_OLE, *TEXT_TYPES, ".zip"})
OLE_MAGIC = bytes.fromhex("d0cf11e0a1b11ae1")


def classify_upload(path: Path, filename: str) -> str:
    """Check that a file is what its name says, for the types chat accepts. Returns its MIME type.

    Images/PDF: file signature. Word/Excel/PowerPoint: the OLE or OOXML container, and for OOXML the
    part folder of that application. Text and code: valid UTF-8 without NUL bytes. Zip: a zip.
    """
    import zipfile

    name = filename.lower()
    suffix = ".env.example" if name.endswith(".env.example") else Path(name).suffix
    if suffix in SIGNATURES:
        return verify_signature(path, filename)
    with open(path, "rb") as handle:
        head = handle.read(8)

    def refuse(what: str) -> AuthError:
        return AuthError(f"“{filename}” isn't a valid {what} (it may be damaged, incomplete or renamed). Nothing was sent.",
                         status_code=415)

    if suffix in OFFICE_OLE:
        if head != OLE_MAGIC:
            raise refuse(suffix[1:].upper() + " file")
        return OFFICE_OLE[suffix]
    if suffix in OFFICE_ZIP or suffix == ".zip":
        if not zipfile.is_zipfile(path):
            raise refuse(suffix[1:].upper() + " file")
        if suffix in OFFICE_ZIP:
            with zipfile.ZipFile(path) as archive:
                names = archive.namelist()
            if "[Content_Types].xml" not in names or not any(n.startswith(OFFICE_ZIP[suffix]) for n in names):
                raise refuse(suffix[1:].upper() + " file")
            return OFFICE_ZIP_TYPES[suffix]
        return "application/zip"
    if suffix in TEXT_TYPES:
        with open(path, "rb") as handle:
            sample = handle.read(256 * 1024)
        if bytes(1) in sample:
            raise refuse("text file")
        try:
            sample.decode("utf-8")
        except UnicodeDecodeError as exc:
            if exc.start < len(sample) - 4:  # a multi-byte character cut by the sample is fine
                raise refuse("UTF-8 text file") from exc
        return TEXT_TYPES[suffix]
    raise AuthError(
        f"“{filename}” can't be sent: this file type isn't allowed in chat. Allowed: images, PDF, Word, Excel, "
        "PowerPoint, text, CSV, code and zip files.",
        status_code=415,
    )


def delete_stored_file(path: str | None) -> None:
    """Remove a stored upload (local file inside the upload directory, or an object in the bucket)."""
    from app.services import storage

    storage.delete(path, upload_root())
