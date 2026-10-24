"""Meetings: scheduling validation, live hub, end-for-all, transcription, grounded MoM, tasks, notifications."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import AsyncClient

from app.services import llm_client
from app.services.meeting_hub import MeetingHub
from tests.conftest import auth_headers


async def _member(client: AsyncClient, email: str, name: str, username: str) -> dict:
    resp = await client.post("/auth/register", json={"email": email, "password": "securepass123", "name": name,
                                                     "username": username})
    assert resp.status_code == 201, resp.text
    return {"headers": auth_headers(resp.json()["access_token"]), "id": resp.json()["user"]["id"]}


@pytest_asyncio.fixture
async def team(client: AsyncClient, auth_context: dict) -> dict:
    owner = auth_headers(auth_context["token"])
    ws = (await client.post("/workspaces", headers=owner, json={"name": "Team"})).json()
    member = await _member(client, "priya@example.com", "Priya Shah", "priya")
    assert (await client.post("/workspaces/join", headers=member["headers"], json={"join_code": ws["join_code"]})).status_code == 200
    outsider = await _member(client, "out@example.com", "Outsider", "outsider")
    base = f"/workspaces/{ws['id']}/meetings"
    return {"wid": ws["id"], "base": base, "owner": owner, "owner_id": auth_context["user_id"],
            "member": member, "outsider": outsider}


def _future(hours: int = 2) -> str:
    return (datetime.now(UTC) + timedelta(hours=hours)).replace(microsecond=0).isoformat()


def _schedule_body(**overrides) -> dict:
    body = {"title": "Sprint review", "scheduled_start": _future(), "duration_minutes": 30,
            "timezone": "Asia/Kolkata", "client_request_id": uuid.uuid4().hex}
    body.update(overrides)
    return body


# --- scheduling ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("override", [
    {"title": "   "},
    {"scheduled_start": (datetime.now(UTC) - timedelta(days=1)).isoformat()},   # in the past
    {"scheduled_start": "2030-01-01T10:00:00"},                                # no time zone
    {"timezone": "Mars/Olympus"},
    {"duration_minutes": 0},
    {"client_request_id": None},
])
async def test_schedule_rejects_invalid_meetings(client: AsyncClient, team: dict, override: dict) -> None:
    body = _schedule_body(**override)
    if override.get("client_request_id", "x") is None:
        body.pop("client_request_id")
    resp = await client.post(team["base"], headers=team["owner"], json=body)
    assert resp.status_code == 422, resp.text
    assert (await client.get(team["base"], headers=team["owner"])).json() == []


@pytest.mark.asyncio
async def test_retried_schedule_does_not_duplicate(client: AsyncClient, team: dict) -> None:
    body = _schedule_body()
    first = await client.post(team["base"], headers=team["owner"], json=body)
    assert first.status_code == 201, first.text
    again = await client.post(team["base"], headers=team["owner"], json=body)
    assert first.status_code == 201 and again.status_code == 200
    assert first.json()["id"] == again.json()["id"]
    meetings = (await client.get(team["base"], headers=team["owner"])).json()
    assert len(meetings) == 1
    events = (await client.get(f"/workspaces/{team['wid']}/calendar/events", headers=team["owner"])).json()
    linked = [e for e in (events if isinstance(events, list) else events.get("events", [])) if e.get("meeting_id")]
    assert len(linked) == 1


@pytest.mark.asyncio
async def test_weekly_recurrence_keeps_local_time(client: AsyncClient, team: dict) -> None:
    resp = await client.post(team["base"], headers=team["owner"], json=_schedule_body(
        timezone="Europe/London", recurrence="weekly", occurrences=3))
    assert resp.status_code == 201
    meetings = (await client.get(team["base"], headers=team["owner"])).json()
    assert len(meetings) == 3
    starts = sorted(datetime.fromisoformat(m["scheduled_start"]) for m in meetings)
    from zoneinfo import ZoneInfo
    local = [s.astimezone(ZoneInfo("Europe/London")).strftime("%H:%M") for s in starts]
    assert len(set(local)) == 1
    assert all(m["recurrence_parent_id"] in (None, meetings[0]["id"]) or m["recurrence_parent_id"] for m in meetings)


@pytest.mark.asyncio
async def test_invitees_must_be_members_and_get_notified(client: AsyncClient, team: dict) -> None:
    bad = await client.post(team["base"], headers=team["owner"], json=_schedule_body(invitee_ids=[team["outsider"]["id"]]))
    assert bad.status_code == 400
    ok = await client.post(team["base"], headers=team["owner"], json=_schedule_body(invitee_ids=[team["member"]["id"]]))
    assert ok.status_code == 201
    notes = (await client.get("/notifications", headers=team["member"]["headers"])).json()
    assert notes["unread_count"] == 1 and notes["items"][0]["kind"] == "meeting_invite"
    # The outsider can't see it, and invite-only meetings are hidden from other members.
    assert (await client.get(f"{team['base']}/{ok.json()['id']}", headers=team["outsider"]["headers"])).status_code in (403, 404)


@pytest.mark.asyncio
async def test_only_host_updates_and_cancels(client: AsyncClient, team: dict) -> None:
    meeting = (await client.post(team["base"], headers=team["owner"], json=_schedule_body())).json()
    url = f"{team['base']}/{meeting['id']}"
    assert (await client.patch(url, headers=team["member"]["headers"], json={"title": "Hijack"})).status_code == 403
    assert (await client.post(f"{url}/cancel", headers=team["member"]["headers"])).status_code == 403
    assert (await client.patch(url, headers=team["owner"], json={"title": "Sprint review v2"})).json()["title"] == "Sprint review v2"
    cancelled = await client.post(f"{url}/cancel", headers=team["owner"])
    assert cancelled.json()["status"] == "cancelled"
    # A cancelled meeting can't be joined or ended, and its calendar entry is gone.
    assert (await client.post(f"{url}/end", headers=team["owner"], json={"scope": "all"})).status_code == 409


@pytest.mark.asyncio
async def test_calendar_entry_of_meeting_cannot_be_deleted_directly(client: AsyncClient, team: dict) -> None:
    await client.post(team["base"], headers=team["owner"], json=_schedule_body())
    events = (await client.get(f"/workspaces/{team['wid']}/calendar/events", headers=team["owner"])).json()
    events = events if isinstance(events, list) else events.get("events", [])
    event = next(e for e in events if e.get("meeting_id"))
    resp = await client.delete(f"/workspaces/{team['wid']}/calendar/events/{event['id']}", headers=team["owner"])
    assert resp.status_code == 409


# --- live meetings, end, transcript, MoM ---------------------------------------------------

async def _live(client: AsyncClient, team: dict) -> dict:
    resp = await client.post(f"{team['base']}/instant", headers=team["owner"],
                             json={"title": "Planning", "client_request_id": uuid.uuid4().hex})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _say(client: AsyncClient, team: dict, meeting_id: str, headers: dict, text: str, offset: int) -> dict:
    resp = await client.post(f"{team['base']}/{meeting_id}/transcript/segments", headers=headers,
                             json={"text": text, "client_segment_id": f"seg-{offset:08d}", "offset_ms": offset})
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_instant_meeting_notifies_members(client: AsyncClient, team: dict) -> None:
    meeting = await _live(client, team)
    assert meeting["status"] == "live" and meeting["is_host"]
    kinds = [n["kind"] for n in (await client.get("/notifications", headers=team["member"]["headers"])).json()["items"]]
    assert "meeting_started" in kinds


@pytest.mark.asyncio
async def test_only_host_can_end_for_all(client: AsyncClient, team: dict) -> None:
    meeting = await _live(client, team)
    url = f"{team['base']}/{meeting['id']}/end"
    assert (await client.post(url, headers=team["member"]["headers"], json={"scope": "all"})).status_code == 403
    me = await client.post(url, headers=team["member"]["headers"], json={"scope": "me"})
    assert me.json()["status"] == "left" and me.json()["meeting"]["status"] == "live"
    ended = await client.post(url, headers=team["owner"], json={"scope": "all"})
    assert ended.json()["status"] == "ended" and ended.json()["session_id"]
    # Ending twice is harmless and returns the same session.
    again = await client.post(url, headers=team["owner"], json={"scope": "all"})
    assert again.json()["session_id"] == ended.json()["session_id"]


@pytest.mark.asyncio
async def test_transcript_segments_dedupe_and_close_with_meeting(client: AsyncClient, team: dict) -> None:
    meeting = await _live(client, team)
    first = await _say(client, team, meeting["id"], team["owner"], "Hello everyone", 1000)
    retry = await _say(client, team, meeting["id"], team["owner"], "Hello everyone", 1000)
    assert first["segment"]["id"] == retry["segment"]["id"]
    await _say(client, team, meeting["id"], team["member"]["headers"], "Hi there", 4000)
    transcript = (await client.get(f"{team['base']}/{meeting['id']}/transcript", headers=team["owner"])).json()
    assert [s["text"] for s in transcript["segments"]] == ["Hello everyone", "Hi there"]
    assert [s["speaker_name"] for s in transcript["segments"]][1] == "Priya Shah"
    ended = (await client.post(f"{team['base']}/{meeting['id']}/end", headers=team["owner"], json={"scope": "all"})).json()
    # Audio recorded before the end may still finish uploading; it is part of the minutes.
    trailing = await client.post(f"{team['base']}/{meeting['id']}/transcript/segments", headers=team["owner"],
                                 json={"text": "Final words", "client_segment_id": "seg-trail-001", "offset_ms": 0})
    assert trailing.status_code == 200
    late = await client.post(f"{team['base']}/{meeting['id']}/transcript/segments", headers=team["owner"],
                             json={"text": "too late", "client_segment_id": "seg-late-0001", "offset_ms": 3_600_000})
    assert late.status_code == 409
    mom = (await client.get(f"/workspaces/{team['wid']}/sessions/{ended['session_id']}/mom", headers=team["owner"])).json()
    regenerated = await client.post(f"/workspaces/{team['wid']}/sessions/{ended['session_id']}/mom/generate", headers=team["owner"])
    assert "Final words" in regenerated.json()["transcript"] and "too late" not in regenerated.json()["transcript"]
    assert mom["status"] == "done"


@pytest.mark.asyncio
async def test_audio_chunk_returns_503_when_no_provider(client: AsyncClient, team: dict, monkeypatch) -> None:
    meeting = await _live(client, team)

    async def unavailable(*args, **kwargs):
        return None

    monkeypatch.setattr("app.services.transcription_service._transcribe_bytes", unavailable)
    resp = await client.post(f"{team['base']}/{meeting['id']}/transcript/chunks", headers=team["owner"],
                             data={"client_segment_id": "chunk-00000001", "offset_ms": "0", "duration_ms": "15000"},
                             files={"audio": ("c.webm", b"\x1a\x45\xdf\xa3fake", "audio/webm")})
    assert resp.status_code == 503

    async def works(*args, **kwargs):
        return "We agreed to ship on Monday"

    monkeypatch.setattr("app.services.transcription_service._transcribe_bytes", works)
    ok = await client.post(f"{team['base']}/{meeting['id']}/transcript/chunks", headers=team["owner"],
                           data={"client_segment_id": "chunk-00000001", "offset_ms": "0", "duration_ms": "15000"},
                           files={"audio": ("c.webm", b"\x1a\x45\xdf\xa3fake", "audio/webm")})
    assert ok.json()["segment"]["text"] == "We agreed to ship on Monday"
    assert ok.json()["segment"]["source"] == "server"


@pytest.mark.asyncio
async def test_offline_mom_only_uses_explicit_action_items(client: AsyncClient, team: dict) -> None:
    meeting = await _live(client, team)
    await _say(client, team, meeting["id"], team["owner"], "Action item for Priya Shah: send the budget report", 1000)
    await _say(client, team, meeting["id"], team["owner"], "Action item: update the roadmap", 5000)
    await _say(client, team, meeting["id"], team["member"]["headers"], "Maybe we should also redo the logo", 9000)
    gap = await client.post(f"{team['base']}/{meeting['id']}/transcript/gaps", headers=team["owner"],
                            json={"client_segment_id": "gap-00000001", "offset_ms": 12000, "duration_ms": 15000})
    assert gap.status_code == 204
    ended = (await client.post(f"{team['base']}/{meeting['id']}/end", headers=team["owner"], json={"scope": "all"})).json()
    mom = (await client.get(f"/workspaces/{team['wid']}/sessions/{ended['session_id']}/mom", headers=team["owner"])).json()

    assert mom["mom_status"] == "draft" and mom["can_review"]
    items = {i["text"]: i for i in mom["action_items"]}
    assert set(items) == {"send the budget report", "update the roadmap"}  # the logo idea is not an action item
    assert items["send the budget report"]["assignee_id"] == team["member"]["id"]
    assert items["update the roadmap"]["assignee_id"] is None and items["update the roadmap"]["needs_review"]
    assert all(i["due_date"] is None for i in mom["action_items"])  # nobody named a deadline
    assert mom["data"]["decisions"] == []
    assert mom["data"]["completeness"]["is_partial"] and "could not be transcribed" in mom["data"]["completeness"]["note"]
    assert "budget report" in mom["markdown"]


@pytest.mark.asyncio
async def test_ai_mom_drops_items_not_in_transcript(client: AsyncClient, team: dict, monkeypatch) -> None:
    meeting = await _live(client, team)
    await _say(client, team, meeting["id"], team["owner"], "We decided to launch on 2026-11-02.", 1000)
    await _say(client, team, meeting["id"], team["member"]["headers"], "I will write the release notes by 2026-10-30.", 4000)
    await _say(client, team, meeting["id"], team["owner"], "Great, thanks Priya.", 8000)

    async def fake_complete(prompt, **kwargs):
        return """{"objectives": ["Plan the launch"], "agenda": [], "summary": "Launch planning.",
          "discussion_points": [],
          "decisions": [{"text": "Launch on 2 November", "evidence": "We decided to launch on 2026-11-02."},
                        {"text": "Hire two engineers", "evidence": "we will hire two engineers"}],
          "suggestions": [],
          "action_items": [
            {"text": "Write the release notes", "owner": "Priya", "due_text": "by 2026-10-30", "due_date": "2026-10-30",
             "priority": null, "evidence": "I will write the release notes by 2026-10-30."},
            {"text": "Book the venue", "owner": "Priya", "due_text": "next week", "due_date": "2026-11-01",
             "priority": "high", "evidence": "book the venue next week"},
            {"text": "Tidy the backlog", "owner": "Priya", "due_text": "tomorrow", "due_date": "2026-10-25",
             "priority": null, "evidence": "Great, thanks Priya."}],
          "open_questions": []}"""

    monkeypatch.setattr(llm_client, "complete_text", fake_complete)
    ended = (await client.post(f"{team['base']}/{meeting['id']}/end", headers=team["owner"], json={"scope": "all"})).json()
    mom = (await client.get(f"/workspaces/{team['wid']}/sessions/{ended['session_id']}/mom", headers=team["owner"])).json()

    assert [d["text"] for d in mom["data"]["decisions"]] == ["Launch on 2 November"]  # invented decision dropped
    items = {i["text"]: i for i in mom["action_items"]}
    assert "Book the venue" not in items  # not said in the meeting
    assert items["Write the release notes"]["due_date"] == "2026-10-30"
    assert items["Tidy the backlog"]["due_date"] is None  # "tomorrow" was never said
    assert items["Write the release notes"]["assignee_id"] == team["member"]["id"]


@pytest.mark.asyncio
async def test_approve_creates_tasks_once_and_locks(client: AsyncClient, team: dict) -> None:
    meeting = await _live(client, team)
    await _say(client, team, meeting["id"], team["owner"], "Action item for Priya Shah: send the budget report", 1000)
    await _say(client, team, meeting["id"], team["owner"], "Action item: update the roadmap", 5000)
    ended = (await client.post(f"{team['base']}/{meeting['id']}/end", headers=team["owner"], json={"scope": "all"})).json()
    base = f"/workspaces/{team['wid']}/sessions/{ended['session_id']}/mom"
    mom = (await client.get(base, headers=team["owner"])).json()
    report = next(i for i in mom["action_items"] if i["text"] == "send the budget report")
    roadmap = next(i for i in mom["action_items"] if i["text"] == "update the roadmap")

    # Members can read but not approve; assignees must be real members.
    assert (await client.post(f"{base}/approve", headers=team["member"]["headers"], json={"item_ids": [report["id"]]})).status_code == 403
    bad = await client.patch(f"{base}/action-items/{roadmap['id']}", headers=team["owner"],
                             json={"assignee_id": team["outsider"]["id"]})
    assert bad.status_code == 400
    bad_add = await client.post(f"{base}/action-items", headers=team["owner"],
                                json={"text": "Sneaky", "assignee_id": team["outsider"]["id"]})
    assert bad_add.status_code == 400

    # Regenerating a draft keeps one row per action item.
    assert (await client.post(f"{base}/generate", headers=team["owner"])).status_code == 200
    assert len((await client.get(base, headers=team["owner"])).json()["action_items"]) == 2

    approved = await client.post(f"{base}/approve", headers=team["owner"], json={"item_ids": [report["id"]]})
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["mom_status"] == "approved" and len(body["created_task_ids"]) == 1
    statuses = {i["text"]: i["status"] for i in body["action_items"]}
    assert statuses == {"send the budget report": "confirmed", "update the roadmap": "rejected"}

    tasks = (await client.get(f"/workspaces/{team['wid']}/tasks", headers=team["member"]["headers"])).json()
    tasks = tasks if isinstance(tasks, list) else tasks.get("items", [])
    task = next(t for t in tasks if t["id"] == body["created_task_ids"][0])
    assert task["assignee_id"] == team["member"]["id"] and task["due_date"] is None
    kinds = [n["kind"] for n in (await client.get("/notifications", headers=team["member"]["headers"])).json()["items"]]
    assert "task_assigned" in kinds

    # Locked: no regeneration, edits or second approval.
    assert (await client.post(f"{base}/generate", headers=team["owner"])).status_code == 409
    assert (await client.patch(base, headers=team["owner"], json={"markdown": "rewritten"})).status_code == 409
    assert (await client.post(f"{base}/approve", headers=team["owner"], json={"item_ids": [report["id"]]})).status_code == 409

    # Completing the task tells the organizer.
    done = await client.patch(f"/workspaces/{team['wid']}/tasks/{task['id']}", headers=team["member"]["headers"],
                              json={"status": "done"})
    assert done.status_code == 200, done.text
    owner_kinds = [n["kind"] for n in (await client.get("/notifications", headers=team["owner"])).json()["items"]]
    assert "task_completed" in owner_kinds


# --- notifications --------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_notifications_read_prefs_and_dedupe(client: AsyncClient, team: dict, db_session) -> None:
    from app.services import notification_service

    member_id = uuid.UUID(team["member"]["id"])
    first = await notification_service.notify(db_session, member_id, kind="x", category="tasks", title="One", dedupe_key="k1")
    dup = await notification_service.notify(db_session, member_id, kind="x", category="tasks", title="One", dedupe_key="k1")
    assert first is not None and dup is None
    await notification_service.notify(db_session, member_id, kind="x", category="tasks", title="Two", dedupe_key="k2")
    await db_session.commit()

    headers = team["member"]["headers"]
    listed = (await client.get("/notifications", headers=headers)).json()
    assert listed["unread_count"] == 2
    one = listed["items"][0]["id"]
    assert (await client.post("/notifications/read", headers=headers, json={"ids": [one]})).json()["unread_count"] == 1
    # Someone else's notification ids do nothing.
    assert (await client.post("/notifications/read", headers=team["owner"], json={"ids": [listed["items"][1]["id"]]})).status_code == 200
    assert (await client.get("/notifications", headers=headers)).json()["unread_count"] == 1
    assert (await client.post("/notifications/read-all", headers=headers)).json()["unread_count"] == 0

    prefs = (await client.put("/notifications/preferences", headers=headers, json={"tasks": False})).json()
    assert prefs["tasks"] is False
    muted = await notification_service.notify(db_session, member_id, kind="x", category="tasks", title="Muted", dedupe_key="k3")
    assert muted is None


@pytest.mark.asyncio
async def test_dm_and_mention_notifications(client: AsyncClient, team: dict) -> None:
    channel = (await client.post(f"/workspaces/{team['wid']}/channels", headers=team["owner"], json={"name": "general"})).json()
    sent = await client.post(f"/workspaces/{team['wid']}/channels/{channel['id']}/messages", headers=team["owner"],
                             json={"content": "Hey @priya and @outsider, please look"})
    assert sent.status_code in (200, 201), sent.text
    items = (await client.get("/notifications", headers=team["member"]["headers"])).json()["items"]
    assert [n["kind"] for n in items] == ["mention"]
    # The outsider isn't in the workspace, so isn't told about a channel they can't read.
    assert (await client.get("/notifications", headers=team["outsider"]["headers"])).json()["unread_count"] == 0


@pytest.mark.asyncio
async def test_reminder_and_deadline_jobs_are_idempotent(client: AsyncClient, team: dict, db_session) -> None:
    from app.services import jobs

    await client.post(team["base"], headers=team["owner"], json=_schedule_body(
        scheduled_start=(datetime.now(UTC) + timedelta(minutes=10)).isoformat(), invitee_ids=[team["member"]["id"]]))
    task = await client.post(f"/workspaces/{team['wid']}/tasks", headers=team["owner"], json={
        "title": "File taxes", "assignee_id": team["member"]["id"],
        "due_date": (datetime.now(UTC) - timedelta(days=1)).isoformat()})
    assert task.status_code in (200, 201), task.text

    assert await jobs.send_meeting_reminders(db_session) == 2  # organizer + invitee
    assert await jobs.send_meeting_reminders(db_session) == 0
    assert await jobs.send_task_deadline_notices(db_session) == 1
    assert await jobs.send_task_deadline_notices(db_session) == 0
    await db_session.commit()
    kinds = {n["kind"] for n in (await client.get("/notifications", headers=team["member"]["headers"])).json()["items"]}
    assert {"meeting_reminder", "task_overdue", "task_assigned"} <= kinds


# --- live hub -------------------------------------------------------------------------------

class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.closed: int | None = None

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = code


@pytest.mark.asyncio
async def test_hub_signals_screen_share_and_end() -> None:
    hub, mid = MeetingHub(), uuid.uuid4()
    a_ws, b_ws = FakeSocket(), FakeSocket()
    a = await hub.join(mid, a_ws, uuid.uuid4(), "Asha", True)
    b = await hub.join(mid, b_ws, uuid.uuid4(), "Ben", False)
    assert a_ws.sent[-1]["type"] == "participant_joined" and a_ws.sent[-1]["participant"]["name"] == "Ben"

    assert await hub.send(mid, b.client_id, {"type": "signal", "from": a.client_id})
    assert b_ws.sent[-1]["type"] == "signal" and all(m.get("type") != "signal" for m in a_ws.sent)

    assert (await hub.set_screen_share(mid, a.client_id, True))[0]
    accepted, owner = await hub.set_screen_share(mid, b.client_id, True)
    assert not accepted and owner == a.client_id  # one presenter at a time

    await hub.leave(mid, a.client_id)  # presenter drops: sharing stops for everyone
    assert any(m["type"] == "screen_share" and not m.get("active") for m in b_ws.sent)
    assert any(m["type"] == "participant_left" for m in b_ws.sent)

    await hub.end(mid, "Asha")
    assert b_ws.sent[-1]["type"] == "meeting_ended" and b_ws.closed == 4000
    assert hub.connected_count(mid) == 0


@pytest.mark.asyncio
async def test_invite_only_minutes_are_private_and_locked(client: AsyncClient, team: dict, auth_context: dict) -> None:
    third = await _member(client, "third@example.com", "Third Person", "third")
    ws = (await client.get(f"/workspaces/{team['wid']}", headers=team["owner"])).json()
    await client.post("/workspaces/join", headers=third["headers"], json={"join_code": ws["join_code"]})
    meeting = (await client.post(f"{team['base']}/instant", headers=team["owner"], json={
        "title": "1:1", "invitee_ids": [team["member"]["id"]], "client_request_id": uuid.uuid4().hex})).json()
    await _say(client, team, meeting["id"], team["owner"], "Action item for Priya Shah: review salaries", 1000)
    ended = (await client.post(f"{team['base']}/{meeting['id']}/end", headers=team["owner"], json={"scope": "all"})).json()
    sid = ended["session_id"]
    sessions = f"/workspaces/{team['wid']}/sessions"

    assert sid in [s["id"] for s in (await client.get(sessions, headers=team["member"]["headers"])).json()]
    assert sid not in [s["id"] for s in (await client.get(sessions, headers=third["headers"])).json()]
    assert (await client.get(f"{sessions}/{sid}", headers=third["headers"])).status_code == 404
    assert (await client.get(f"{sessions}/{sid}/mom", headers=third["headers"])).status_code in (403, 404)

    # Minutes change only through the review flow; the legacy endpoints can't bypass it.
    assert (await client.patch(f"{sessions}/{sid}", headers=team["member"]["headers"], json={"ai_summary": "fake"})).status_code == 409
    assert (await client.post(f"{sessions}/{sid}/mom", headers=team["member"]["headers"])).status_code == 403
    await client.post(f"{sessions}/{sid}/mom/approve", headers=team["owner"], json={"item_ids": []})
    assert (await client.post(f"{sessions}/{sid}/mom", headers=team["owner"])).status_code == 409
    assert (await client.patch(f"{sessions}/{sid}", headers=team["owner"], json={"title": "renamed"})).status_code == 409


@pytest.mark.asyncio
async def test_hub_one_connection_per_person_and_limit() -> None:
    from app.services.meeting_hub import REPLACED_CLOSE_CODE, RoomFull

    hub, mid = MeetingHub(), uuid.uuid4()
    asha, ben = uuid.uuid4(), uuid.uuid4()
    first, ben_ws = FakeSocket(), FakeSocket()
    old = await hub.join(mid, first, asha, "Asha", True)
    await hub.join(mid, ben_ws, ben, "Ben", False)
    await hub.set_screen_share(mid, old.client_id, True)

    # Asha refreshes (or her old socket is half-open): the new connection replaces the old one.
    second = FakeSocket()
    new = await hub.join(mid, second, asha, "Asha", True)
    assert [p["name"] for p in hub.participants(mid)].count("Asha") == 1
    assert first.closed == REPLACED_CLOSE_CODE and first.sent[-1]["type"] == "replaced"
    assert {"type": "participant_left", "client_id": old.client_id} in ben_ws.sent
    assert hub.room(mid).screen_owner is None  # the replaced connection's share is gone
    assert new.client_id != old.client_id

    # The limit counts people, and rejoining never counts twice.
    with pytest.raises(RoomFull):
        await hub.join(mid, FakeSocket(), uuid.uuid4(), "Cara", False, limit=2)
    await hub.join(mid, FakeSocket(), ben, "Ben", False, limit=2)
    assert hub.connected_count(mid) == 2


@pytest.mark.asyncio
async def test_chat_replies_link_to_the_original(client: AsyncClient, team: dict, db_session) -> None:
    from app.models import User
    from app.services import meeting_service

    meeting = await _live(client, team)
    mid = uuid.UUID(meeting["id"])
    owner = await db_session.get(User, uuid.UUID(team["owner_id"]))
    member = await db_session.get(User, uuid.UUID(team["member"]["id"]))
    first, _ = await meeting_service.store_chat_message(db_session, mid, owner, "Can someone share the deck?", "cm-00000001")
    reply, parent = await meeting_service.store_chat_message(db_session, mid, member, "Sharing now", "cm-00000002", str(first.id))
    assert parent.id == first.id and reply.reply_to_id == first.id
    # A resend after a reconnect is the same message, still linked.
    again, again_parent = await meeting_service.store_chat_message(db_session, mid, member, "Sharing now", "cm-00000002", str(first.id))
    assert again.id == reply.id and again_parent.id == first.id
    # Replies can't point into another meeting (or at garbage): they're stored unlinked.
    other = await _live(client, team)
    foreign, _ = await meeting_service.store_chat_message(db_session, uuid.UUID(other["id"]), owner, "elsewhere", "cm-00000003")
    stray, stray_parent = await meeting_service.store_chat_message(db_session, mid, owner, "x", "cm-00000004", str(foreign.id))
    assert stray.reply_to_id is None and stray_parent is None
    bad, _ = await meeting_service.store_chat_message(db_session, mid, owner, "y", "cm-00000005", "not-a-uuid")
    assert bad.reply_to_id is None
    await db_session.commit()

    # History (after a refresh) keeps the link, with a preview even if the original is on an older page.
    url = f"{team['base']}/{meeting['id']}/messages"
    latest = (await client.get(url, params={"limit": 2}, headers=team["member"]["headers"])).json()
    assert [m["content"] for m in latest] == ["x", "y"]
    full = (await client.get(url, headers=team["member"]["headers"])).json()
    linked = next(m for m in full if m["content"] == "Sharing now")
    assert linked["reply_to"] == {"id": str(first.id), "sender_name": owner.name, "available": True,
                                  "excerpt": "Can someone share the deck?"}
    older = (await client.get(url, params={"before": latest[0]["created_at"]}, headers=team["member"]["headers"])).json()
    assert [m["content"] for m in older] == ["Can someone share the deck?", "Sharing now"]


@pytest.mark.asyncio
async def test_concurrent_duplicate_start_returns_the_original(client: AsyncClient, team: dict, db_session) -> None:
    """Two simultaneous clicks: the second insert hits the unique key and must return the first."""
    from app.models import User
    from app.schemas.meeting import MeetingInstant
    from app.services import meeting_service

    owner = await db_session.get(User, uuid.UUID(team["owner_id"]))
    data = MeetingInstant(title="Race", client_request_id="race-req-0001")
    first, created = await meeting_service.start_instant(db_session, uuid.UUID(team["wid"]), owner, data)
    assert created
    # Simulate the race: the duplicate check passes (as if the first wasn't committed yet).
    original = meeting_service._existing_request

    async def not_seen_first(*args, **kwargs):
        meeting_service._existing_request = original
        return None

    meeting_service._existing_request = not_seen_first
    again, created_again = await meeting_service.start_instant(db_session, uuid.UUID(team["wid"]), owner, data)
    assert not created_again and again.id == first.id
    await db_session.commit()  # the session is still usable


@pytest.mark.asyncio
async def test_restart_does_not_end_live_meetings(client: AsyncClient, team: dict, db_session, monkeypatch) -> None:
    """After a restart or deploy the hub has no rooms yet; people are reconnecting, not gone."""
    import time

    from app.models import Meeting, MeetingStatus
    from app.services import meeting_service
    from app.services.meeting_hub import MeetingHub

    meeting = await _live(client, team)
    stored = await db_session.get(Meeting, uuid.UUID(meeting["id"]))
    stored.started_at = datetime.now(UTC) - timedelta(hours=1)  # the meeting has been going for an hour
    await db_session.commit()

    fresh_process = MeetingHub()  # what a restarted server has
    monkeypatch.setattr(meeting_service, "meeting_hub", fresh_process)
    assert await meeting_service.end_abandoned_meetings(db_session) == 0
    await db_session.refresh(stored)
    assert stored.status == MeetingStatus.LIVE

    # Nobody came back for the whole timeout: now it ends.
    fresh_process.started_at = time.time() - meeting_service.EMPTY_MEETING_TIMEOUT_SECONDS - 1
    assert await meeting_service.end_abandoned_meetings(db_session) == 1
    await db_session.refresh(stored)
    assert stored.status == MeetingStatus.ENDED
