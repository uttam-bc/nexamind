"""Chat attachments: uploads scoped to a conversation, shared library files/pages, retries, cleanup."""

import hashlib
import io
import uuid
from datetime import datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.conftest import auth_headers
from tests.test_uploads import MINIMAL_PDF, _png


async def _user(client: AsyncClient, email: str, name: str, username: str) -> dict:
    resp = await client.post("/auth/register", json={"email": email, "password": "securepass123", "name": name,
                                                     "username": username})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    return {"headers": auth_headers(body["access_token"]), "id": body["user"]["id"]}


def _docx() -> bytes:
    """A minimal valid Word file (the parts Word needs to open it)."""
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" '
                   'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                   'Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/'
                   'wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Quarterly report</w:t></w:r></w:p></w:body></w:document>')
    return buf.getvalue()


@pytest_asyncio.fixture
async def team(client: AsyncClient, auth_context: dict) -> dict:
    owner = auth_headers(auth_context["token"])
    ws = (await client.post("/workspaces", headers=owner, json={"name": "Team"})).json()
    member = await _user(client, "priya@example.com", "Priya", "priya")
    await client.post("/workspaces/join", headers=member["headers"], json={"join_code": ws["join_code"]})
    outsider = await _user(client, "zed@example.com", "Zed", "zed")
    channel = (await client.post(f"/workspaces/{ws['id']}/channels", headers=owner, json={"name": "general"})).json()
    return {"wid": ws["id"], "owner": owner, "member": member, "outsider": outsider,
            "channel": channel["id"], "base": f"/workspaces/{ws['id']}/channels/{channel['id']}"}


async def _upload(client, base, headers, name, data, mime, client_id=None):
    form = {"client_upload_id": client_id} if client_id else None
    return await client.post(f"{base}/attachments", headers=headers, files={"file": (name, data, mime)}, data=form)


@pytest.mark.asyncio
@pytest.mark.parametrize("name,data,mime", [
    ("photo.png", _png(), "image/png"),
    ("report.pdf", MINIMAL_PDF, "application/pdf"),
    ("report.docx", _docx(), "application/octet-stream"),
    ("notes.csv", b"a,b\n1,2\n", "text/csv"),
    ("main.py", "print('héllo')\n".encode(), "text/x-python"),
])
async def test_send_files_and_download_the_originals(client: AsyncClient, team: dict, name, data, mime) -> None:
    up = await _upload(client, team["base"], team["owner"], name, data, mime)
    assert up.status_code == 201, up.text
    sent = await client.post(f"{team['base']}/messages", headers=team["owner"],
                             json={"content": "Please review", "attachment_ids": [up.json()["id"]]})
    assert sent.status_code == 201, sent.text
    att = sent.json()["attachments"][0]
    assert att["kind"] == "upload" and att["name"] == name and att["size"] == len(data) and att["available"]

    # After a refresh the attachment is still there, and the member gets the exact bytes.
    listed = (await client.get(f"{team['base']}/messages", headers=team["member"]["headers"])).json()
    assert listed[-1]["attachments"][0]["id"] == att["id"]
    down = await client.get(f"{team['base']}/attachments/{att['id']}/download", headers=team["member"]["headers"])
    assert down.status_code == 200
    assert hashlib.sha256(down.content).hexdigest() == hashlib.sha256(data).hexdigest()
    assert "attachment" in down.headers["content-disposition"]


@pytest.mark.asyncio
@pytest.mark.parametrize("name,data", [
    ("evil.docx", b"PK\x03\x04 not really a word file"),
    ("photo.png", b"<script>alert(1)</script>"),
    ("tool.exe", b"MZ\x90\x00"),
    ("page.svg", b"<svg onload=alert(1)>"),
    ("binary.txt", b"abc\x00\x01\x02"),
])
async def test_disguised_or_disallowed_files_are_refused(client: AsyncClient, team: dict, name, data) -> None:
    resp = await _upload(client, team["base"], team["owner"], name, data, "application/octet-stream")
    assert resp.status_code == 415, resp.text


@pytest.mark.asyncio
async def test_retries_do_not_duplicate_files_or_messages(client: AsyncClient, team: dict) -> None:
    first = await _upload(client, team["base"], team["owner"], "a.png", _png(), "image/png", "upload-retry-01")
    again = await _upload(client, team["base"], team["owner"], "a.png", _png(), "image/png", "upload-retry-01")
    assert first.json()["id"] == again.json()["id"]
    body = {"content": "hi", "attachment_ids": [first.json()["id"]], "client_message_id": "message-retry-01"}
    one = await client.post(f"{team['base']}/messages", headers=team["owner"], json=body)
    two = await client.post(f"{team['base']}/messages", headers=team["owner"], json=body)
    assert one.json()["id"] == two.json()["id"]
    assert len((await client.get(f"{team['base']}/messages", headers=team["owner"])).json()) == 1
    # The same upload can't be attached to a second, different message.
    other = await client.post(f"{team['base']}/messages", headers=team["owner"],
                              json={"content": "again", "attachment_ids": [first.json()["id"]]})
    assert other.status_code == 409


@pytest.mark.asyncio
async def test_chat_files_stay_inside_their_conversation(client: AsyncClient, team: dict) -> None:
    private = (await client.post(f"/workspaces/{team['wid']}/channels", headers=team["owner"],
                                 json={"name": "leads", "is_private": True})).json()
    base = f"/workspaces/{team['wid']}/channels/{private['id']}"
    up = await _upload(client, base, team["owner"], "salaries.pdf", MINIMAL_PDF, "application/pdf")
    sent = (await client.post(f"{base}/messages", headers=team["owner"], json={"attachment_ids": [up.json()["id"]]})).json()
    att = sent["attachments"][0]

    member = team["member"]["headers"]  # a workspace member, but not in this private channel
    assert (await client.get(f"{base}/attachments/{att['id']}/download", headers=member)).status_code in (403, 404)
    # Not reachable through the workspace Files library either, nor listed there.
    assert (await client.get(f"/workspaces/{team['wid']}/files/{up.json()['id']}/download", headers=member)).status_code == 404
    assert (await client.get(f"/workspaces/{team['wid']}/files/{up.json()['id']}/download", headers=team["owner"])).status_code == 404
    assert up.json()["id"] not in [f["id"] for f in (await client.get(f"/workspaces/{team['wid']}/files", headers=team["owner"])).json()]
    # Someone else's upload can't be attached, and uploads to a channel you can't read are refused.
    stolen = await client.post(f"{team['base']}/messages", headers=member, json={"attachment_ids": [up.json()["id"]]})
    assert stolen.status_code == 400
    assert (await _upload(client, base, member, "x.png", _png(), "image/png")).status_code in (403, 404)


@pytest.mark.asyncio
async def test_sharing_library_files_and_pages_by_reference(client: AsyncClient, team: dict, db_session) -> None:
    lib = (await client.post(f"/workspaces/{team['wid']}/files", headers=team["owner"],
                             files={"file": ("plan.png", _png(), "image/png")})).json()
    page = (await client.post(f"/workspaces/{team['wid']}/documents", headers=team["owner"],
                              json={"title": "Launch plan", "content": {"text": "Steps"}})).json()
    sent = await client.post(f"{team['base']}/messages", headers=team["owner"], json={
        "content": "Please review this before the meeting.", "shared_file_ids": [lib["id"]], "shared_document_ids": [page["id"]]})
    assert sent.status_code == 201, sent.text
    file_att, page_att = sent.json()["attachments"]
    assert file_att["kind"] == "file" and file_att["file_id"] == lib["id"]
    assert page_att["kind"] == "document" and page_att["document_id"] == page["id"] and page_att["name"] == "Launch plan"
    files = (await client.get(f"/workspaces/{team['wid']}/files", headers=team["owner"])).json()
    assert len(files) == 1  # shared by reference: no copy was made

    down = await client.get(f"{team['base']}/attachments/{file_att['id']}/download", headers=team["member"]["headers"])
    assert down.status_code == 200 and down.content == _png()

    # A DM with someone outside the workspace: they see the card, but opening the file is refused.
    dm = (await client.post(f"/workspaces/{team['wid']}/channels/dm", headers=team["owner"], json={"target_username": "zed"})).json()
    dm_base = f"/workspaces/{dm['workspace_id']}/channels/{dm['id']}"
    shared = (await client.post(f"{dm_base}/messages", headers=team["owner"], json={"shared_file_ids": [lib["id"]]})).json()
    denied = await client.get(f"{dm_base}/attachments/{shared['attachments'][0]['id']}/download", headers=team["outsider"]["headers"])
    assert denied.status_code == 403 and "don't have access" in denied.json()["detail"]
    # An outsider can't share files from a workspace they don't belong to.
    assert (await client.post(f"{dm_base}/messages", headers=team["outsider"]["headers"],
                              json={"shared_file_ids": [lib["id"]]})).status_code == 404

    # Deleting the original leaves a card that says it's unavailable.
    await client.delete(f"/workspaces/{team['wid']}/documents/{page['id']}", headers=team["owner"])
    listed = (await client.get(f"{team['base']}/messages", headers=team["owner"])).json()
    page_card = listed[-1]["attachments"][1]
    assert page_card["available"] is False and page_card["name"] == "Launch plan"


@pytest.mark.asyncio
async def test_message_needs_text_or_a_file(client: AsyncClient, team: dict) -> None:
    assert (await client.post(f"{team['base']}/messages", headers=team["owner"], json={"content": "  "})).status_code == 422


@pytest.mark.asyncio
async def test_unsent_uploads_are_cleaned_up(client: AsyncClient, team: dict, db_session) -> None:
    from app.models import FileRecord
    from app.services import attachment_service

    kept = await _upload(client, team["base"], team["owner"], "kept.png", _png(), "image/png")
    await client.post(f"{team['base']}/messages", headers=team["owner"], json={"attachment_ids": [kept.json()["id"]]})
    orphan = await _upload(client, team["base"], team["owner"], "orphan.png", _png(), "image/png")
    removed = await attachment_service.cleanup_unsent_uploads(db_session, now=datetime.now() + timedelta(days=2))
    assert removed == 1
    assert await db_session.get(FileRecord, uuid.UUID(orphan.json()["id"])) is None
    assert await db_session.get(FileRecord, uuid.UUID(kept.json()["id"])) is not None


@pytest.mark.asyncio
async def test_meeting_chat_attachments(client: AsyncClient, team: dict, db_session) -> None:
    from app.models import User
    from app.services import meeting_service

    meeting = (await client.post(f"/workspaces/{team['wid']}/meetings/instant", headers=team["owner"],
                                 json={"title": "Sync", "client_request_id": uuid.uuid4().hex})).json()
    mbase = f"/workspaces/{team['wid']}/meetings/{meeting['id']}"
    up = await client.post(f"{mbase}/attachments", headers=team["owner"], files={"file": ("deck.pdf", MINIMAL_PDF, "application/pdf")})
    assert up.status_code == 201, up.text
    owner = await db_session.get(User, uuid.UUID((await client.get("/auth/me", headers=team["owner"])).json()["id"]))
    message, _ = await meeting_service.store_chat_message(db_session, uuid.UUID(meeting["id"]), owner, "Slides",
                                                          "meeting-msg-0001", upload_ids=[uuid.UUID(up.json()["id"])])
    await db_session.commit()
    history = (await client.get(f"{mbase}/messages", headers=team["member"]["headers"])).json()
    att = history[-1]["attachments"][0]
    assert att["name"] == "deck.pdf"
    down = await client.get(f"{mbase}/attachments/{att['id']}/download", headers=team["member"]["headers"])
    assert down.status_code == 200 and down.content == MINIMAL_PDF
    # Not visible to people outside the workspace.
    assert (await client.get(f"{mbase}/attachments/{att['id']}/download", headers=team["outsider"]["headers"])).status_code in (403, 404)
