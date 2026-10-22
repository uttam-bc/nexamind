"""Write a page's Markdown as a Word (.docx) file, including images stored in the workspace.

Standard library only: a .docx is a zip of XML parts. Supported: headings, paragraphs, **bold**,
*italic*, `code`, links, bullet/numbered lists, checklists, quotes, code blocks, tables, rules
and images written as ``![alt](file:<file id>)``. Other images become their alt text.
"""

import io
import re
import struct
import zipfile
from collections.abc import Awaitable, Callable
from pathlib import Path
from uuid import UUID
from xml.sax.saxutils import escape

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import storage

EMU_PER_PIXEL = 9525
MAX_WIDTH_EMU = 6 * 914400  # 6 inches: the text width of a default Letter/A4 page
EMBEDDABLE = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif"}
MAX_IMAGE_BYTES = 10 * 1024 * 1024
IMAGE_LINE = re.compile(r"^!\[([^\]]*)\]\(([^)\s]+)\)\s*$")
INLINE = re.compile(r"(\*\*[^*]+\*\*|__[^_]+__|(?<![\w*])\*[^*\s][^*]*\*(?!\w)|(?<!\w)_[^_\s][^_]*_(?!\w)|`[^`]+`|~~[^~]+~~|!\[[^\]]*\]\([^)\s]+\)|\[[^\]]+\]\([^)\s]+\))")

ImageLoader = Callable[[str], Awaitable[tuple[bytes, str] | None]]


async def load_workspace_image(db: AsyncSession, workspace_id: UUID, user_id: UUID, file_id: str) -> tuple[bytes, str] | None:
    """Bytes and extension of an image file the user can see in this workspace, else None."""
    from app.services.file_service import get_file_record
    from app.services.auth_service import AuthError

    try:
        record = await get_file_record(db, workspace_id, UUID(file_id), user_id)
    except (ValueError, AuthError):
        return None
    ext = Path(record.filename).suffix.lower()
    if ext not in EMBEDDABLE or (record.file_size or 0) > MAX_IMAGE_BYTES or not await storage.exists(record.file_path):
        return None
    async with storage.local_copy(record.file_path) as local_path:
        return Path(local_path).read_bytes(), ext


def _image_size(data: bytes) -> tuple[int, int] | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        return struct.unpack(">II", data[16:24])
    if data[:6] in (b"GIF87a", b"GIF89a") and len(data) >= 10:
        return struct.unpack("<HH", data[6:10])
    if data[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            length = struct.unpack(">H", data[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                height, width = struct.unpack(">HH", data[i + 5:i + 9])
                return width, height
            i += 2 + length
    return None


class _Doc:
    def __init__(self) -> None:
        self.body: list[str] = []
        self.rels: list[str] = []
        self.media: list[tuple[str, bytes]] = []
        self.next_rel = 10
        self.next_image = 1
        # numId 1 = bullets; each numbered list gets its own numId so numbering restarts at 1.
        self.numbered_lists: list[int] = []

    def rel(self, kind: str, target: str, external: bool = False) -> str:
        rid = f"rId{self.next_rel}"
        self.next_rel += 1
        mode = ' TargetMode="External"' if external else ""
        self.rels.append(
            f'<Relationship Id="{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{kind}" '
            f'Target="{escape(target, {chr(34): "&quot;"})}"{mode}/>'
        )
        return rid

    # --- runs -------------------------------------------------------------------------------
    @staticmethod
    def run(text: str, bold=False, italic=False, code=False, strike=False, link=False) -> str:
        props = ""
        if bold:
            props += "<w:b/>"
        if italic:
            props += "<w:i/>"
        if strike:
            props += "<w:strike/>"
        if code:
            props += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:fill="F1F5F9"/>'
        if link:
            props += '<w:color w:val="4F46E5"/><w:u w:val="single"/>'
        props = f"<w:rPr>{props}</w:rPr>" if props else ""
        parts = text.split("\n")
        runs = []
        for index, part in enumerate(parts):
            br = "<w:br/>" if index else ""
            runs.append(f'<w:r>{props}{br}<w:t xml:space="preserve">{escape(part)}</w:t></w:r>')
        return "".join(runs)

    def inline(self, text: str, bold=False, italic=False) -> str:
        out = []
        for piece in INLINE.split(text):
            if not piece:
                continue
            if (piece.startswith("**") and piece.endswith("**")) or (piece.startswith("__") and piece.endswith("__")):
                out.append(self.inline(piece[2:-2], bold=True, italic=italic))
            elif piece.startswith("~~") and piece.endswith("~~"):
                out.append(self.run(piece[2:-2], bold, italic, strike=True))
            elif piece.startswith("`") and piece.endswith("`"):
                out.append(self.run(piece[1:-1], bold, italic, code=True))
            elif piece.startswith("!["):
                alt = re.match(r"!\[([^\]]*)\]", piece).group(1)
                out.append(self.run(f"[image: {alt or 'image'}]", bold, italic=True))
            elif piece.startswith("[") and "](" in piece:
                label, url = re.match(r"\[([^\]]+)\]\(([^)\s]+)\)", piece).groups()
                if re.match(r"^(https?:|mailto:)", url, re.I):
                    rid = self.rel("hyperlink", url, external=True)
                    out.append(f'<w:hyperlink r:id="{rid}">{self.run(label, bold, italic, link=True)}</w:hyperlink>')
                else:
                    out.append(self.run(label, bold, italic))
            elif len(piece) > 2 and piece[0] in "*_" and piece[-1] == piece[0]:
                out.append(self.inline(piece[1:-1], bold=bold, italic=True))
            else:
                out.append(self.run(piece, bold, italic))
        return "".join(out)

    # --- blocks -----------------------------------------------------------------------------
    def new_numbered_list(self) -> int:
        num_id = 2 + len(self.numbered_lists)
        self.numbered_lists.append(num_id)
        return num_id

    def para(self, content: str, style: str | None = None, indent: int = 0, shade: str | None = None,
             spacing_after: int | None = None, num_id: int | None = None, level: int = 0) -> None:
        props = ""
        if style:
            props += f'<w:pStyle w:val="{style}"/>'
        if shade:
            props += f'<w:shd w:val="clear" w:fill="{shade}"/>'
        if num_id is not None:
            props += f'<w:numPr><w:ilvl w:val="{min(level, 8)}"/><w:numId w:val="{num_id}"/></w:numPr>'
        if spacing_after is not None:
            props += f'<w:spacing w:after="{spacing_after}"/>'
        if indent:
            props += f'<w:ind w:left="{indent}"/>'
        self.body.append(f"<w:p><w:pPr>{props}</w:pPr>{content}</w:p>")

    def image(self, data: bytes, ext: str, alt: str) -> None:
        size = _image_size(data) or (800, 600)
        cx, cy = size[0] * EMU_PER_PIXEL, size[1] * EMU_PER_PIXEL
        if cx > MAX_WIDTH_EMU:
            cy = int(cy * MAX_WIDTH_EMU / cx)
            cx = MAX_WIDTH_EMU
        number = self.next_image
        self.next_image += 1
        name = f"image{number}{ext}"
        self.media.append((name, data))
        rid = self.rel("image", f"media/{name}")
        alt_attr = escape(alt or "image", {'"': "&quot;"})
        drawing = (
            f'<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
            f'<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{number}" name="Picture {number}" descr="{alt_attr}"/>'
            f'<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            f'<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            f'<pic:nvPicPr><pic:cNvPr id="{number}" name="{name}" descr="{alt_attr}"/><pic:cNvPicPr/></pic:nvPicPr>'
            f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
            f'<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>'
            f"</wp:inline></w:drawing></w:r>"
        )
        self.para(drawing)

    def table(self, rows: list[list[str]]) -> None:
        def cells(row: list[str], header: bool) -> str:
            return "".join(
                f'<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>'
                f'{"<w:shd w:val=\"clear\" w:fill=\"F1F5F9\"/>" if header else ""}</w:tcPr>'
                f"<w:p>{self.inline(cell, bold=header)}</w:p></w:tc>"
                for cell in row
            )

        border = '<w:{0} w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>'
        borders = "".join(border.format(side) for side in ("top", "left", "bottom", "right", "insideH", "insideV"))
        xml = [f'<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>{borders}</w:tblBorders></w:tblPr>']
        for index, row in enumerate(rows):
            xml.append(f"<w:tr>{cells(row, index == 0)}</w:tr>")
        xml.append("</w:tbl>")
        self.body.append("".join(xml))
        self.para("", spacing_after=0)


def _table_rows(lines: list[str]) -> list[list[str]]:
    rows = []
    for line in lines:
        cells = [c.replace("\\|", "|").strip() for c in re.split(r"(?<!\\)\|", line.strip().strip("|"))]
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells):
            continue
        rows.append(cells)
    width = max((len(r) for r in rows), default=0)
    return [r + [""] * (width - len(r)) for r in rows]


async def markdown_to_docx(markdown: str, title: str, load_image: ImageLoader) -> bytes:
    doc = _Doc()
    lines = markdown.replace("\r\n", "\n").split("\n")
    first = next((line.strip() for line in lines if line.strip()), "")
    heading = re.match(r"^#{1,6}\s+(.*)$", first)
    # Pages often start with their own title as a heading; don't print it twice.
    if not (heading and heading.group(1).strip().lower() == title.strip().lower()):
        doc.para(doc.run(title), style="Title")
    i = 0
    numbered_list: int | None = None
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("```"):
            code = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            doc.para(doc.run("\n".join(code), code=True), shade="F1F5F9")
            i += 1
            continue
        if stripped.startswith("|"):
            block = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                block.append(lines[i])
                i += 1
            rows = _table_rows(block)
            if rows:
                doc.table(rows)
            continue
        i += 1
        if not re.match(r"^\d+\.\s", stripped):
            numbered_list = None
        if not stripped:
            continue
        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        image = IMAGE_LINE.match(stripped)
        if heading:
            doc.para(doc.inline(heading.group(2)), style=f"Heading{min(len(heading.group(1)), 3)}")
        elif image:
            alt, src = image.groups()
            loaded = await load_image(src[5:]) if src.startswith("file:") else None
            if loaded:
                doc.image(loaded[0], loaded[1], alt)
            else:
                doc.para(doc.run(f"[image: {alt or 'image'}]", italic=True))
        elif re.match(r"^- \[[ xX]\]\s", stripped):
            checked = stripped[3].lower() == "x"
            doc.para(doc.run("☑ " if checked else "☐ ") + doc.inline(stripped[6:]), indent=360)
        elif re.match(r"^[-*+]\s", stripped):
            depth = (len(line) - len(line.lstrip())) // 2
            doc.para(doc.inline(stripped[2:]), num_id=1, level=depth)
        elif re.match(r"^\d+\.\s", stripped):
            if numbered_list is None:
                numbered_list = doc.new_numbered_list()
            doc.para(doc.inline(re.sub(r"^\d+\.\s", "", stripped)), num_id=numbered_list)
        elif stripped.startswith(">"):
            doc.para(doc.inline(stripped.lstrip("> ").strip(), italic=True), indent=720, shade="F8FAFC")
        elif stripped in ("---", "***", "___"):
            doc.body.append('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="CBD5E1"/></w:pBdr></w:pPr></w:p>')
        else:
            doc.para(doc.inline(stripped))

    return _package(doc)


STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>"""


def _numbering(doc: _Doc) -> str:
    def levels(fmt: str) -> str:
        out = []
        for lvl in range(9):
            text = "•" if fmt == "bullet" else f"%{lvl + 1}."
            out.append(
                f'<w:lvl w:ilvl="{lvl}"><w:start w:val="1"/><w:numFmt w:val="{"bullet" if fmt == "bullet" else "decimal"}"/>'
                f'<w:lvlText w:val="{text}"/><w:lvlJc w:val="left"/>'
                f'<w:pPr><w:ind w:left="{720 * (lvl + 1)}" w:hanging="360"/></w:pPr></w:lvl>'
            )
        return "".join(out)

    nums = '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' + "".join(
        f'<w:num w:numId="{n}"><w:abstractNumId w:val="1"/>'
        f'<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>'
        for n in doc.numbered_lists
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:abstractNum w:abstractNumId="0">{levels("bullet")}</w:abstractNum>'
        f'<w:abstractNum w:abstractNumId="1">{levels("decimal")}</w:abstractNum>'
        f"{nums}</w:numbering>"
    )


def _package(doc: _Doc) -> bytes:
    namespaces = (
        'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
        'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"'
    )
    section = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
    document_xml = (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document {namespaces}><w:body>'
        + "".join(doc.body) + section + "</w:body></w:document>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
        + "".join(doc.rels) + "</Relationships>"
    )
    image_types = "".join(
        f'<Default Extension="{ext[1:]}" ContentType="{mime}"/>' for ext, mime in EMBEDDABLE.items()
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>' + image_types +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
        "</Types>"
    )
    package_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", package_rels)
        archive.writestr("word/document.xml", document_xml)
        archive.writestr("word/styles.xml", STYLES)
        archive.writestr("word/numbering.xml", _numbering(doc))
        archive.writestr("word/_rels/document.xml.rels", rels)
        for name, data in doc.media:
            archive.writestr(f"word/media/{name}", data)
    return buffer.getvalue()
