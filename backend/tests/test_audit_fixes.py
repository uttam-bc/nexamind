"""Regression tests for functional audit findings (NX-BUG-007, 009, 010, 011, 018 and NX-PERF-006)."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.database as app_db
from app.database import enable_sqlite_foreign_keys, get_db
from app.main import app
from tests.conftest import auth_headers

BACKEND = Path(__file__).resolve().parent.parent


async def _member(client: AsyncClient, email: str, name: str = "Member") -> dict:
    resp = await client.post("/auth/register", json={"email": email, "password": "securepass123", "name": name})
    assert resp.status_code == 201, resp.text
    return {"headers": auth_headers(resp.json()["access_token"]), "id": resp.json()["user"]["id"]}


@pytest_asyncio.fixture
async def team(client: AsyncClient, auth_context: dict) -> dict:
    owner = auth_headers(auth_context["token"])
    ws = (await client.post("/workspaces", headers=owner, json={"name": "Team"})).json()
    member = await _member(client, "member@example.com")
    assert (await client.post("/workspaces/join", headers=member["headers"], json={"join_code": ws["join_code"]})).status_code == 200
    return {"wid": ws["id"], "name": ws["name"], "owner": owner, "owner_id": auth_context["user_id"], "member": member}


# --- NX-BUG-009: whitespace-only names ------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("path,body", [
    ("/tasks", {"title": "   "}),
    ("/documents", {"title": "   "}),
    ("/channels", {"name": "   "}),
    ("/finance/transactions", {"type": "expense", "amount": 5, "category": "  ", "date": "2026-10-01T00:00:00"}),
])
async def test_whitespace_only_names_rejected(client: AsyncClient, auth_context: dict, path: str, body: dict) -> None:
    resp = await client.post(f"/workspaces/{auth_context['workspace_id']}{path}", headers=auth_headers(auth_context["token"]), json=body)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_workspace_name_trimmed(client: AsyncClient, auth_context: dict) -> None:
    headers = auth_headers(auth_context["token"])
    assert (await client.post("/workspaces", headers=headers, json={"name": "   "})).status_code == 422
    ok = await client.post("/workspaces", headers=headers, json={"name": "  Ops  "})
    assert ok.json()["name"] == "Ops"


# --- NX-BUG-010: amounts --------------------------------------------------------------------

@pytest.mark.asyncio
async def test_amounts_are_bounded_and_totals_stay_finite(client: AsyncClient, auth_context: dict) -> None:
    base = f"/workspaces/{auth_context['workspace_id']}/finance"
    headers = auth_headers(auth_context["token"])
    tx = {"type": "expense", "category": "Ops", "date": "2026-10-01T00:00:00"}
    assert (await client.post(f"{base}/transactions", headers=headers, json={**tx, "amount": 1e308})).status_code == 422
    assert (await client.post(f"{base}/transactions", headers=headers, json={**tx, "amount": 1e12})).status_code == 201
    assert (await client.post(f"{base}/transactions", headers=headers, json={**tx, "amount": 1e12})).status_code == 201
    summary = (await client.get(f"{base}/summary", headers=headers)).json()
    assert summary["total_expenses"] == 2e12
    assert summary["cash_balance"] == -2e12


# --- NX-BUG-011: dates ----------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("event", [
    {"event_date": "not-a-date"},
    {"event_date": "2026-02-30"},
    {"event_date": "2026-03-01", "event_time": "25:61"},
])
async def test_invalid_calendar_dates_rejected(client: AsyncClient, auth_context: dict, event: dict) -> None:
    resp = await client.post(f"/workspaces/{auth_context['workspace_id']}/calendar/events",
                             headers=auth_headers(auth_context["token"]), json={"title": "Sync", **event})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_valid_calendar_date_accepted(client: AsyncClient, auth_context: dict) -> None:
    resp = await client.post(f"/workspaces/{auth_context['workspace_id']}/calendar/events",
                             headers=auth_headers(auth_context["token"]),
                             json={"title": "Sync", "event_date": "2026-11-05", "event_time": "2:30 PM"})
    assert resp.status_code == 201


# --- NX-BUG-018: team lifecycle -------------------------------------------------------------

@pytest.mark.asyncio
async def test_member_can_leave_but_last_owner_cannot(client: AsyncClient, team: dict) -> None:
    wid = team["wid"]
    assert (await client.post(f"/workspaces/{wid}/leave", headers=team["owner"])).status_code == 409
    assert (await client.post(f"/workspaces/{wid}/leave", headers=team["member"]["headers"])).status_code == 204
    assert (await client.get(f"/workspaces/{wid}", headers=team["member"]["headers"])).status_code == 404


@pytest.mark.asyncio
async def test_roles_and_member_removal(client: AsyncClient, team: dict) -> None:
    wid, member = team["wid"], team["member"]
    # Members can't change roles or remove people.
    assert (await client.patch(f"/workspaces/{wid}/members/{team['owner_id']}", headers=member["headers"], json={"role": "member"})).status_code == 403
    assert (await client.delete(f"/workspaces/{wid}/members/{team['owner_id']}", headers=member["headers"])).status_code == 403
    # The last owner can't be demoted.
    assert (await client.patch(f"/workspaces/{wid}/members/{team['owner_id']}", headers=team["owner"], json={"role": "member"})).status_code == 409
    # Promote, then the original owner may leave.
    assert (await client.patch(f"/workspaces/{wid}/members/{member['id']}", headers=team["owner"], json={"role": "owner"})).status_code == 204
    assert (await client.post(f"/workspaces/{wid}/leave", headers=team["owner"])).status_code == 204
    detail = (await client.get(f"/workspaces/{wid}", headers=member["headers"])).json()
    assert detail["owner_id"] == member["id"]


@pytest.mark.asyncio
async def test_owner_removes_member(client: AsyncClient, team: dict) -> None:
    wid, member = team["wid"], team["member"]
    assert (await client.delete(f"/workspaces/{wid}/members/{member['id']}", headers=team["owner"])).status_code == 204
    assert (await client.get(f"/workspaces/{wid}/documents", headers=member["headers"])).status_code == 404


@pytest.mark.asyncio
async def test_delete_workspace_requires_owner_and_name(client: AsyncClient, team: dict) -> None:
    wid = team["wid"]
    await client.post(f"/workspaces/{wid}/documents", headers=team["owner"], json={"title": "Doc"})
    assert (await client.request("DELETE", f"/workspaces/{wid}", headers=team["member"]["headers"], json={"confirm_name": "Team"})).status_code == 403
    assert (await client.request("DELETE", f"/workspaces/{wid}", headers=team["owner"], json={"confirm_name": "Wrong"})).status_code == 400
    assert (await client.request("DELETE", f"/workspaces/{wid}", headers=team["owner"], json={"confirm_name": "Team"})).status_code == 204
    assert (await client.get(f"/workspaces/{wid}", headers=team["owner"])).status_code == 404


@pytest.mark.asyncio
async def test_personal_workspace_cannot_be_left_or_deleted(client: AsyncClient, auth_context: dict) -> None:
    wid, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    assert (await client.post(f"/workspaces/{wid}/leave", headers=headers)).status_code in (400, 409)
    assert (await client.request("DELETE", f"/workspaces/{wid}", headers=headers, json={"confirm_name": "x"})).status_code == 400


@pytest.mark.asyncio
async def test_message_edit_delete_and_channel_delete(client: AsyncClient, team: dict) -> None:
    wid, member = team["wid"], team["member"]
    channel = (await client.post(f"/workspaces/{wid}/channels", headers=member["headers"], json={"name": "general-2"})).json()
    base = f"/workspaces/{wid}/channels/{channel['id']}"
    msg = (await client.post(f"{base}/messages", headers=member["headers"], json={"content": "hello"})).json()
    owner_msg = (await client.post(f"{base}/messages", headers=team["owner"], json={"content": "owner says"})).json()

    assert (await client.patch(f"{base}/messages/{owner_msg['id']}", headers=member["headers"], json={"content": "x"})).status_code == 403
    edited = await client.patch(f"{base}/messages/{msg['id']}", headers=member["headers"], json={"content": " hello again "})
    assert edited.status_code == 200 and edited.json()["content"] == "hello again" and edited.json()["edited_at"]
    assert (await client.patch(f"{base}/messages/{msg['id']}", headers=member["headers"], json={"content": "   "})).status_code == 422

    assert (await client.delete(f"{base}/messages/{owner_msg['id']}", headers=member["headers"])).status_code == 403
    assert (await client.delete(f"{base}/messages/{msg['id']}", headers=team["owner"])).status_code == 204  # moderation
    remaining = (await client.get(f"{base}/messages", headers=team["owner"])).json()
    assert [m["id"] for m in remaining] == [owner_msg["id"]]

    other = await _member(client, "third@example.com")
    ws = (await client.get(f"/workspaces/{wid}", headers=team["owner"])).json()
    await client.post("/workspaces/join", headers=other["headers"], json={"join_code": ws["join_code"]})
    assert (await client.delete(base, headers=other["headers"])).status_code == 403
    assert (await client.delete(base, headers=member["headers"])).status_code == 204  # creator
    assert (await client.get(base, headers=team["owner"])).status_code == 404


# --- NX-PERF-006: pagination ----------------------------------------------------------------

@pytest.mark.asyncio
async def test_list_endpoints_paginate(client: AsyncClient, auth_context: dict) -> None:
    wid, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    for i in range(5):
        await client.post(f"/workspaces/{wid}/tasks", headers=headers, json={"title": f"T{i}", "position": i})
    page1 = (await client.get(f"/workspaces/{wid}/tasks?limit=2", headers=headers)).json()
    page3 = (await client.get(f"/workspaces/{wid}/tasks?limit=2&offset=4", headers=headers)).json()
    assert [t["title"] for t in page1] == ["T0", "T1"] and [t["title"] for t in page3] == ["T4"]
    assert (await client.get(f"/workspaces/{wid}/tasks?limit=5000", headers=headers)).status_code == 422


@pytest.mark.asyncio
async def test_message_cursor_pagination(client: AsyncClient, auth_context: dict) -> None:
    wid, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    channel = (await client.post(f"/workspaces/{wid}/channels", headers=headers, json={"name": "log"})).json()
    base = f"/workspaces/{wid}/channels/{channel['id']}/messages"
    for i in range(4):
        await client.post(base, headers=headers, json={"content": f"m{i}"})
    latest = (await client.get(f"{base}?limit=2", headers=headers)).json()
    assert [m["content"] for m in latest] == ["m2", "m3"]
    older = (await client.get(base, headers=headers, params={"limit": 2, "before": latest[0]["created_at"]})).json()
    assert [m["content"] for m in older] == ["m0", "m1"]


# --- NX-BUG-007 / NX-REL-005: run against a schema built by Alembic, not create_all ----------

@pytest_asyncio.fixture
async def migrated_client(tmp_path) -> AsyncClient:
    db_file = tmp_path / "migrated.db"
    url = f"sqlite+aiosqlite:///{db_file.as_posix()}"
    env = {**os.environ, "DATABASE_URL": url}
    result = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env,
                            capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, result.stderr[-2000:]

    engine = create_async_engine(url, future=True)
    enable_sqlite_foreign_keys(engine.sync_engine)
    factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False, autoflush=False)
    old_factory, old_engine = app_db.AsyncSessionLocal, app_db.engine
    app_db.AsyncSessionLocal, app_db.engine = factory, engine

    async def override_get_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.engine = engine
        yield client
    app.dependency_overrides.clear()
    app_db.AsyncSessionLocal, app_db.engine = old_factory, old_engine
    await engine.dispose()


@pytest.mark.asyncio
async def test_sessions_reports_and_video_work_on_migrated_sqlite(migrated_client: AsyncClient) -> None:
    client = migrated_client
    reg = (await client.post("/auth/register", json={"email": "m@example.com", "password": "securepass123", "name": "M"})).json()
    headers = auth_headers(reg["access_token"])
    wid = (await client.get("/workspaces", headers=headers)).json()[0]["id"]

    session = await client.post(f"/workspaces/{wid}/sessions", headers=headers,
                                json={"title": "Standup", "transcript": "We agreed to ship on Friday."})
    assert session.status_code == 201, session.text
    report = await client.post(f"/workspaces/{wid}/reports/generate", headers=headers,
                               json={"title": "Weekly", "session_ids": [session.json()["id"]]})
    assert report.status_code == 201, report.text
    meeting = await client.post(f"/workspaces/{wid}/meetings/instant", headers=headers, json={"title": "Sync"})
    assert meeting.status_code == 201, meeting.text
    ended = await client.post(f"/workspaces/{wid}/meetings/{meeting.json()['id']}/end", headers=headers, json={"scope": "all"})
    assert ended.status_code == 200, ended.text
    mom = await client.get(f"/workspaces/{wid}/sessions/{ended.json()['session_id']}/mom", headers=headers)
    assert mom.status_code == 200 and mom.json()["mom_status"] == "draft"

    # Server-side defaults must work for rows inserted without explicit timestamps.
    async with client.engine.begin() as conn:
        await conn.execute(text("INSERT INTO contact_messages (id, name, email, message) VALUES ('x1', 'a', 'a@b.c', 'hi')"))
        row = (await conn.execute(text("SELECT created_at, delivered FROM contact_messages WHERE id = 'x1'"))).one()
    assert row.created_at is not None and row.delivered in (0, False)


# --- NX-REL-004: TURN configuration ---------------------------------------------------------

@pytest.mark.asyncio
async def test_ice_servers_include_turn_when_configured(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    from app.config import get_settings

    wid, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    default = (await client.get(f"/workspaces/{wid}/video/ice-servers", headers=headers)).json()
    assert default["relay_available"] is False and all(s["urls"].startswith("stun:") for s in default["iceServers"])

    settings = get_settings()
    monkeypatch.setattr(settings, "webrtc_turn_urls", ["turn:turn.example.test:3478"])
    monkeypatch.setattr(settings, "webrtc_turn_username", "user")
    monkeypatch.setattr(settings, "webrtc_turn_credential", "secret")
    configured = (await client.get(f"/workspaces/{wid}/video/ice-servers", headers=headers)).json()
    assert configured["relay_available"] is True
    assert configured["iceServers"][-1] == {"urls": ["turn:turn.example.test:3478"], "username": "user", "credential": "secret"}

    outsider = await _member(client, "outsider@example.com")
    assert (await client.get(f"/workspaces/{wid}/video/ice-servers", headers=outsider["headers"])).status_code == 404
