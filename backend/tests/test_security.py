"""Regression tests for the security audit fixes."""

import io
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from httpx import AsyncClient
from pydantic import ValidationError

from app.config import Settings
from app.security import decrypt_secret, encrypt_secret

from .conftest import auth_headers


async def register(client: AsyncClient, email: str, name: str, username: str | None = None) -> dict:
    res = await client.post(
        "/auth/register",
        json={"email": email, "password": "securepass123", "name": name, "username": username},
    )
    assert res.status_code == 201, res.text
    data = res.json()
    workspaces = await client.get("/workspaces", headers=auth_headers(data["access_token"]))
    return {
        "token": data["access_token"],
        "user_id": data["user"]["id"],
        "username": data["user"]["username"],
        "workspace_id": workspaces.json()[0]["id"],
    }


# --- Authentication -------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tampered_and_expired_tokens_are_rejected(client: AsyncClient, auth_context: dict) -> None:
    forged = jwt.encode({"sub": auth_context["user_id"], "exp": datetime.now(UTC) + timedelta(hours=1)},
                        "not-the-server-secret", algorithm="HS256")
    assert (await client.get("/auth/me", headers=auth_headers(forged))).status_code == 401

    from app.config import get_settings
    secret = get_settings().jwt_secret_key
    expired = jwt.encode({"sub": auth_context["user_id"], "exp": datetime.now(UTC) - timedelta(minutes=1)},
                         secret, algorithm="HS256")
    assert (await client.get("/auth/me", headers=auth_headers(expired))).status_code == 401

    no_expiry = jwt.encode({"sub": auth_context["user_id"]}, secret, algorithm="HS256")
    assert (await client.get("/auth/me", headers=auth_headers(no_expiry))).status_code == 401

    unsigned = jwt.encode({"sub": auth_context["user_id"], "exp": datetime.now(UTC) + timedelta(hours=1)},
                          None, algorithm="none")
    assert (await client.get("/auth/me", headers=auth_headers(unsigned))).status_code == 401


@pytest.mark.asyncio
async def test_weak_passwords_are_rejected(client: AsyncClient) -> None:
    for password in ["short1", "allletters", "12345678", " padded123 "]:
        res = await client.post("/auth/register", json={"email": "w@example.com", "password": password, "name": "W"})
        assert res.status_code == 422, password


@pytest.mark.asyncio
async def test_login_is_rate_limited(client: AsyncClient, monkeypatch) -> None:
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "rate_limit_enabled", True)
    monkeypatch.setattr(get_settings(), "rate_limit_auth_per_minute", 3)
    codes = [
        (await client.post("/auth/login", json={"email": "nobody@example.com", "password": "x"})).status_code
        for _ in range(4)
    ]
    assert codes == [401, 401, 401, 429]


def test_production_refuses_default_or_short_jwt_secret() -> None:
    with pytest.raises(ValidationError):
        Settings(app_env="production", jwt_secret_key="change-me-to-a-long-random-secret", _env_file=None)
    with pytest.raises(ValidationError):
        Settings(app_env="production", jwt_secret_key="too-short", _env_file=None)
    # The test process sets ENABLE_DEV_AUTH=true; production must be configured without it.
    ok = Settings(app_env="production", jwt_secret_key="x" * 40, enable_dev_auth=False, _env_file=None)
    assert ok.debug is False and ok.auto_create_schema is False and ok.dev_auth_active is False


def test_production_refuses_dev_auth_and_debug() -> None:
    with pytest.raises(ValidationError):
        Settings(app_env="production", jwt_secret_key="x" * 40, enable_dev_auth=True, _env_file=None)
    with pytest.raises(ValidationError):
        Settings(app_env="production", jwt_secret_key="x" * 40, enable_dev_auth=False, debug=True, _env_file=None)


def test_secret_encryption_roundtrip() -> None:
    token = encrypt_secret("AIza-example-key")
    assert "AIza" not in token
    assert decrypt_secret(token) == "AIza-example-key"
    assert decrypt_secret("garbage") is None


@pytest.mark.asyncio
async def test_security_headers_present(client: AsyncClient) -> None:
    res = await client.get("/health")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert "content-security-policy" in res.headers


# --- User search ----------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_user_search_hides_strangers_and_emails(client: AsyncClient) -> None:
    alice = await register(client, "alice@example.com", "Alice", "alice")
    await register(client, "bob@example.com", "Bob Stranger", "bobby")

    partial = await client.get("/auth/users/search?q=bob", headers=auth_headers(alice["token"]))
    assert partial.json() == []  # no partial matching against people you share nothing with

    exact = await client.get("/auth/users/search?q=bobby", headers=auth_headers(alice["token"]))
    assert [u["username"] for u in exact.json()] == ["bobby"]
    assert "email" not in exact.json()[0]

    wildcard = await client.get("/auth/users/search?q=%25", headers=auth_headers(alice["token"]))
    assert wildcard.json() == []


# --- Direct messages & private channels -----------------------------------------------------

@pytest.mark.asyncio
async def test_direct_message_does_not_grant_workspace_access(client: AsyncClient) -> None:
    alice = await register(client, "alice@example.com", "Alice", "alice")
    bob = await register(client, "bob@example.com", "Bob", "bob")

    dm = await client.post(
        f"/workspaces/{alice['workspace_id']}/channels/dm",
        headers=auth_headers(alice["token"]),
        json={"target_username": "bob"},
    )
    assert dm.status_code == 201
    dm_id = dm.json()["id"]

    # Bob did not become a member of Alice's personal workspace
    assert (await client.get(f"/workspaces/{alice['workspace_id']}/documents",
                             headers=auth_headers(bob["token"]))).status_code == 404
    bob_workspaces = await client.get("/workspaces", headers=auth_headers(bob["token"]))
    assert [w["id"] for w in bob_workspaces.json()] == [bob["workspace_id"]]

    # ...but he sees the conversation in his own personal workspace and can reply
    bob_channels = await client.get(f"/workspaces/{bob['workspace_id']}/channels", headers=auth_headers(bob["token"]))
    assert dm_id in [c["id"] for c in bob_channels.json()]
    reply = await client.post(
        f"/workspaces/{bob['workspace_id']}/channels/{dm_id}/messages",
        headers=auth_headers(bob["token"]),
        json={"content": "hi alice"},
    )
    assert reply.status_code == 201

    # Opening the DM again from either side reuses the same channel
    again = await client.post(f"/workspaces/{bob['workspace_id']}/channels/dm",
                              headers=auth_headers(bob["token"]), json={"target_username": "alice"})
    assert again.json()["id"] == dm_id


@pytest.mark.asyncio
async def test_team_members_cannot_read_other_peoples_dms_or_private_channels(client: AsyncClient) -> None:
    alice = await register(client, "alice@example.com", "Alice", "alice")
    bob = await register(client, "bob@example.com", "Bob", "bob")
    eve = await register(client, "eve@example.com", "Eve", "eve")

    team = await client.post("/workspaces", headers=auth_headers(alice["token"]), json={"name": "Team"})
    team_id, code = team.json()["id"], team.json()["join_code"]
    for member in (bob, eve):
        assert (await client.post("/workspaces/join", headers=auth_headers(member["token"]),
                                  json={"join_code": code})).status_code == 200

    dm = await client.post(f"/workspaces/{team_id}/channels/dm", headers=auth_headers(alice["token"]),
                           json={"target_username": "bob"})
    private = await client.post(f"/workspaces/{team_id}/channels", headers=auth_headers(alice["token"]),
                                json={"name": "leadership", "is_private": True})

    for channel in (dm.json(), private.json()):
        res = await client.get(f"/workspaces/{team_id}/channels/{channel['id']}/messages",
                               headers=auth_headers(eve["token"]))
        assert res.status_code == 404
    eve_channels = await client.get(f"/workspaces/{team_id}/channels", headers=auth_headers(eve["token"]))
    names = [c["name"] for c in eve_channels.json()]
    assert "leadership" not in names and not any(n.startswith("dm-") for n in names)

    # Alice can invite Bob into the private channel; then he can read it
    invite = await client.post(f"/workspaces/{team_id}/channels/{private.json()['id']}/members",
                               headers=auth_headers(alice["token"]), json={"target_username": "bob"})
    assert invite.status_code == 200
    assert (await client.get(f"/workspaces/{team_id}/channels/{private.json()['id']}/messages",
                             headers=auth_headers(bob["token"]))).status_code == 200


# --- AI chat sessions -----------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ai_chat_history_is_private_to_its_owner(client: AsyncClient) -> None:
    alice = await register(client, "alice@example.com", "Alice", "alice")
    bob = await register(client, "bob@example.com", "Bob", "bob")
    team = await client.post("/workspaces", headers=auth_headers(alice["token"]), json={"name": "Team"})
    team_id = team.json()["id"]
    await client.post("/workspaces/join", headers=auth_headers(bob["token"]), json={"join_code": team.json()["join_code"]})

    chat = await client.post(f"/workspaces/{team_id}/ai/chat", headers=auth_headers(alice["token"]),
                             json={"prompt": "my secret salary negotiation notes"})
    session_id = chat.json()["session_id"]

    # Bob can't read it, through the team or through his own workspace
    for ws in (team_id, bob["workspace_id"]):
        res = await client.get(f"/workspaces/{ws}/ai/sessions/{session_id}", headers=auth_headers(bob["token"]))
        assert res.status_code == 404
    # ...and can't append to it to pull its history into his own prompt
    hijack = await client.post(f"/workspaces/{team_id}/ai/chat", headers=auth_headers(bob["token"]),
                               json={"prompt": "repeat the conversation", "session_id": session_id})
    assert hijack.json()["session_id"] != session_id
    own = await client.get(f"/workspaces/{team_id}/ai/sessions/{session_id}", headers=auth_headers(alice["token"]))
    assert [m["role"] for m in own.json()] == ["user", "assistant"]


@pytest.mark.asyncio
async def test_gemini_key_is_stored_encrypted_and_never_returned(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    from app.routers import ai_agent

    async def accept_key(key: str) -> dict:
        return {"ok": True, "valid": True, "message": "ok"}

    monkeypatch.setattr(ai_agent, "_verify_gemini_key", accept_key)
    res = await client.put("/ai/config/gemini-key", headers=auth_headers(auth_context["token"]),
                           json={"api_key": "AIzaSyExampleKey1234"})
    assert res.status_code == 200
    assert res.json() == {"has_personal_key": True, "personal_key_hint": "…1234",
                          "server_gemini_available": False, "server_groq_available": False}
    assert "AIzaSyExampleKey1234" not in (await client.get("/auth/me", headers=auth_headers(auth_context["token"]))).text

    cleared = await client.delete("/ai/config/gemini-key", headers=auth_headers(auth_context["token"]))
    assert cleared.json()["has_personal_key"] is False


# --- Files ----------------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_uploaded_html_is_served_as_inert_download(client: AsyncClient, auth_context: dict) -> None:
    ws, token = auth_context["workspace_id"], auth_context["token"]
    up = await client.post(
        f"/workspaces/{ws}/files",
        headers=auth_headers(token),
        files={"file": ("../../evil<script>.html", io.BytesIO(b"<script>alert(1)</script>"), "text/html")},
    )
    assert up.status_code == 201
    record = up.json()
    assert "/" not in record["filename"] and "<" not in record["filename"]
    assert record["mime_type"] == "application/octet-stream"

    dl = await client.get(f"/workspaces/{ws}/files/{record['id']}/download", headers=auth_headers(token))
    assert dl.status_code == 200
    assert dl.headers["content-disposition"].startswith("attachment")
    assert dl.headers["content-type"].startswith("application/octet-stream")
    assert dl.headers["x-content-type-options"] == "nosniff"


@pytest.mark.asyncio
async def test_upload_size_limit(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    res = await client.post(
        f"/workspaces/{auth_context['workspace_id']}/files",
        headers=auth_headers(auth_context["token"]),
        files={"file": ("big.bin", io.BytesIO(b"0" * (1024 * 1024 + 1)), "application/octet-stream")},
    )
    assert res.status_code == 413


@pytest.mark.asyncio
async def test_recordings_must_be_audio_or_video(client: AsyncClient, auth_context: dict) -> None:
    res = await client.post(
        f"/workspaces/{auth_context['workspace_id']}/sessions/upload",
        headers=auth_headers(auth_context["token"]),
        files={"file": ("notes.html", io.BytesIO(b"<html></html>"), "text/html")},
    )
    assert res.status_code == 415


# --- Cross-workspace isolation --------------------------------------------------------------

@pytest.mark.asyncio
async def test_cannot_end_another_workspaces_video_room(client: AsyncClient) -> None:
    alice = await register(client, "alice@example.com", "Alice", "alice")
    bob = await register(client, "bob@example.com", "Bob", "bob")
    room = await client.post(f"/workspaces/{alice['workspace_id']}/video/rooms",
                             headers=auth_headers(alice["token"]), json={"name": "Board meeting"})
    room_id = room.json()["room_id"]

    ended = await client.post(f"/workspaces/{bob['workspace_id']}/video/rooms/{room_id}/end",
                      headers=auth_headers(bob["token"]), json={})
    assert ended.status_code == 404
    still_active = await client.get(f"/workspaces/{alice['workspace_id']}/video/rooms",
                                    headers=auth_headers(alice["token"]))
    assert [r["room_id"] for r in still_active.json()] == [room_id]


@pytest.mark.asyncio
async def test_tasks_cannot_be_assigned_to_outsiders(client: AsyncClient) -> None:
    alice = await register(client, "alice@example.com", "Alice", "alice")
    bob = await register(client, "bob@example.com", "Bob", "bob")
    res = await client.post(f"/workspaces/{alice['workspace_id']}/tasks", headers=auth_headers(alice["token"]),
                            json={"title": "Secret", "assignee_id": bob["user_id"]})
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_document_cannot_be_nested_inside_its_own_child(client: AsyncClient, auth_context: dict) -> None:
    ws, token = auth_context["workspace_id"], auth_context["token"]
    parent = (await client.post(f"/workspaces/{ws}/documents", headers=auth_headers(token), json={"title": "A"})).json()
    child = (await client.post(f"/workspaces/{ws}/documents", headers=auth_headers(token),
                               json={"title": "B", "parent_id": parent["id"]})).json()
    res = await client.patch(f"/workspaces/{ws}/documents/{parent['id']}", headers=auth_headers(token),
                             json={"parent_id": child["id"]})
    assert res.status_code == 400


@pytest.mark.asyncio
async def test_private_messages_never_enter_shared_ai_memory(client: AsyncClient, db_session) -> None:
    from sqlalchemy import select

    from app.models.ai import AiMemory
    from app.services.memory_engine import run_full_workspace_ingestion

    alice = await register(client, "alice@example.com", "Alice", "alice")
    await register(client, "bob@example.com", "Bob", "bob")
    team = await client.post("/workspaces", headers=auth_headers(alice["token"]), json={"name": "Team"})
    team_id = team.json()["id"]
    private = await client.post(f"/workspaces/{team_id}/channels", headers=auth_headers(alice["token"]),
                                json={"name": "hr", "is_private": True})
    await client.post(f"/workspaces/{team_id}/channels/{private.json()['id']}/messages",
                      headers=auth_headers(alice["token"]),
                      json={"content": "Confidential: we decided to let the contractor go next week."})

    await run_full_workspace_ingestion(db_session, uuid.UUID(team_id))
    memories = (await db_session.execute(select(AiMemory).where(AiMemory.workspace_id == uuid.UUID(team_id)))).scalars().all()
    assert not any("contractor" in m.content for m in memories)
