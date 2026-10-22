"""Turn uploaded files into document text (markdown) so they can be previewed, edited and searched.

DOCX is read with the standard library (it is a zip of XML); headings, lists, bold/italic and tables
become markdown. PDF text comes from pypdf (scanned PDFs without a text layer yield nothing).
"""

import io
import re
import zipfile
from xml.etree import ElementTree

from app.services.auth_service import AuthError

MAX_IMPORT_BYTES = 15 * 1024 * 1024
MAX_EXTRACTED_CHARS = 500_000
TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".csv", ".json", ".log"}
SUPPORTED = TEXT_EXTENSIONS | {".docx", ".pdf"}

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
# Pictures inside an imported .docx are written as ![alt](docx-media:word/media/x.png) and swapped
# for stored workspace files by the library service.
DOCX_MEDIA_PREFIX = "docx-media:"
DOCX_MEDIA_LINK = re.compile(r"!\[([^\]]*)\]\(docx-media:([^)\s]+)\)")


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16"):
        try:
            text = data.decode(encoding)
            if "\x00" not in text:
                return text
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _run_images(run: ElementTree.Element) -> str:
    images = []
    for drawing in run.iter(f"{W}drawing"):
        blip = drawing.find(f".//{A}blip")
        doc_pr = drawing.find(f".//{WP}docPr")
        rid = blip.get(f"{R}embed") if blip is not None else None
        if rid:
            alt = (doc_pr.get("descr") or doc_pr.get("name") or "image") if doc_pr is not None else "image"
            images.append(f"![{alt.replace(']', '')}]({DOCX_MEDIA_PREFIX}rid:{rid})")
    return "".join(images)


def _run_text(run: ElementTree.Element) -> str:
    images = _run_images(run)
    if images:
        return images
    parts = []
    for node in run:
        if node.tag == f"{W}t":
            parts.append(node.text or "")
        elif node.tag == f"{W}tab":
            parts.append("\t")
        elif node.tag in (f"{W}br", f"{W}cr"):
            parts.append("\n")
    text = "".join(parts)
    if not text.strip():
        return text
    props = run.find(f"{W}rPr")
    bold = props is not None and props.find(f"{W}b") is not None and props.find(f"{W}b").get(f"{W}val") not in ("0", "false")
    italic = props is not None and props.find(f"{W}i") is not None and props.find(f"{W}i").get(f"{W}val") not in ("0", "false")
    lead = text[: len(text) - len(text.lstrip())]
    trail = text[len(text.rstrip()):]
    core = text.strip()
    if bold:
        core = f"**{core}**"
    if italic:
        core = f"*{core}*"
    return f"{lead}{core}{trail}"


def _paragraph_text(paragraph: ElementTree.Element) -> str:
    pieces = []
    for child in paragraph:
        if child.tag == f"{W}r":
            pieces.append(_run_text(child))
        elif child.tag == f"{W}hyperlink":
            pieces.extend(_run_text(r) for r in child.findall(f"{W}r"))
    return "".join(pieces).replace("****", "")


def _paragraph_markdown(paragraph: ElementTree.Element) -> str:
    text = _paragraph_text(paragraph).strip()
    if not text:
        return ""
    props = paragraph.find(f"{W}pPr")
    style = ""
    if props is not None and props.find(f"{W}pStyle") is not None:
        style = (props.find(f"{W}pStyle").get(f"{W}val") or "").lower()
    heading = re.match(r"heading\s*([1-6])|title", style)
    if heading:
        level = int(heading.group(1)) if heading.group(1) else 1
        return f"{'#' * level} {text.replace('**', '')}"
    if props is not None and props.find(f"{W}numPr") is not None:
        level_node = props.find(f"{W}numPr/{W}ilvl")
        depth = int(level_node.get(f"{W}val", "0")) if level_node is not None else 0
        return f"{'  ' * depth}- {text}"
    if "quote" in style:
        return f"> {text}"
    return text


def _table_markdown(table: ElementTree.Element) -> str:
    rows = []
    for tr in table.findall(f"{W}tr"):
        cells = []
        for tc in tr.findall(f"{W}tc"):
            cell = " ".join(_paragraph_text(p).strip() for p in tc.findall(f"{W}p")).strip()
            cells.append(cell.replace("|", "\\|") or " ")
        rows.append(cells)
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [" "] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def docx_to_markdown(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            info = archive.getinfo("word/document.xml")
            if info.file_size > 50 * 1024 * 1024:  # guard against zip bombs
                raise AuthError("This Word document is too large to import", status_code=413)
            xml = archive.read(info)
            rels_xml = archive.read("word/_rels/document.xml.rels") if "word/_rels/document.xml.rels" in archive.namelist() else b""
    except (zipfile.BadZipFile, KeyError) as exc:
        raise AuthError("This file isn't a valid .docx document", status_code=400) from exc
    targets = {}
    if rels_xml:
        for rel in ElementTree.fromstring(rels_xml):
            target = rel.get("Target") or ""
            if rel.get("TargetMode") != "External":
                targets[rel.get("Id")] = "word/" + target.lstrip("/").removeprefix("word/")
    root = ElementTree.fromstring(xml)
    body = root.find(f"{W}body")
    blocks = []
    for element in list(body) if body is not None else []:
        if element.tag == f"{W}p":
            line = _paragraph_markdown(element)
            if line:
                blocks.append(line)
        elif element.tag == f"{W}tbl":
            table = _table_markdown(element)
            if table:
                blocks.append(table)
    # Keep consecutive list items together; separate other blocks with blank lines.
    out: list[str] = []
    for block in blocks:
        if out and not (block.lstrip().startswith("- ") and out[-1].lstrip().startswith("- ")):
            out.append("")
        out.append(block)
    markdown = "\n".join(out).strip()
    # Resolve picture relationship ids to their paths inside the package.
    return re.sub(
        rf"\({re.escape(DOCX_MEDIA_PREFIX)}rid:([^)]+)\)",
        lambda m: f"({DOCX_MEDIA_PREFIX}{targets[m.group(1)]})" if m.group(1) in targets else "(missing)",
        markdown,
    )


def docx_media(data: bytes, path: str) -> bytes | None:
    """One picture from inside a .docx (None if absent or implausibly large)."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            info = archive.getinfo(path)
            if info.file_size > 20 * 1024 * 1024:
                return None
            return archive.read(info)
    except (zipfile.BadZipFile, KeyError):
        return None


def pdf_to_text(data: bytes) -> str:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise AuthError("This PDF is password-protected", status_code=400)
        pages = []
        for number, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").strip()
            if text:
                pages.append(f"## Page {number}\n\n{text}")
    except PdfReadError as exc:
        raise AuthError("This file isn't a readable PDF", status_code=400) from exc
    return "\n\n".join(pages).strip()


def file_to_markdown(filename: str, data: bytes) -> str:
    """Extract document text from an upload. Raises AuthError for unsupported or unreadable files."""
    suffix = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if suffix == ".doc":
        raise AuthError("Old .doc files can't be imported. Save it as .docx or PDF and try again.", status_code=415)
    if suffix not in SUPPORTED:
        raise AuthError("Supported files: .docx, .pdf, .md, .txt, .csv, .json", status_code=415)
    if suffix == ".docx":
        text = docx_to_markdown(data)
    elif suffix == ".pdf":
        text = pdf_to_text(data)
        if not text:
            raise AuthError("No text found in this PDF (it may be a scanned image).", status_code=422)
    elif suffix == ".json" or suffix == ".csv":
        lang = suffix[1:]
        text = f"```{lang}\n{_decode_text(data).strip()}\n```"
    else:
        text = _decode_text(data)
    return text[:MAX_EXTRACTED_CHARS]


# Previews for uploaded files. PDFs and raster images are shown by the browser from the file bytes;
# everything here becomes plain text or Markdown so nothing uploaded is ever rendered as HTML.
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
CODE_EXTENSIONS = {".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".h", ".cs", ".go", ".rs",
                   ".rb", ".php", ".sql", ".sh", ".yml", ".yaml", ".toml", ".ini", ".css", ".html", ".xml"}
MAX_PREVIEW_CHARS = 200_000


def _suffix(filename: str) -> str:
    return "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def preview_kind(filename: str, mime_type: str | None) -> str:
    """How the browser should show a file: pdf, image, markdown, code, text, audio, video or none."""
    suffix = _suffix(filename)
    mime = (mime_type or "").lower()
    if suffix == ".pdf" or mime == "application/pdf":
        return "pdf"
    if suffix in IMAGE_EXTENSIONS:  # SVG is excluded on purpose: it can carry script
        return "image"
    if suffix in {".docx", ".md", ".markdown"}:
        return "markdown"
    if suffix in CODE_EXTENSIONS or suffix == ".json":
        return "code"
    if suffix in {".txt", ".csv", ".log"} or mime.startswith("text/"):
        return "text"
    if mime.startswith("audio/"):
        return "audio"
    if mime.startswith("video/"):
        return "video"
    return "none"


def preview_text(filename: str, data: bytes) -> str:
    """Readable text for markdown/code/text previews."""
    if _suffix(filename) == ".docx":
        return DOCX_MEDIA_LINK.sub(lambda m: f"*[image: {m.group(1)}]*", docx_to_markdown(data))[:MAX_PREVIEW_CHARS]
    return _decode_text(data)[:MAX_PREVIEW_CHARS]
