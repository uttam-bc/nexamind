import io
import uuid

import pytest
from httpx import AsyncClient

from app.models.session import SessionStatus
from app.services.session_service import process_session_pipeline


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_session_direct_creation_and_crud(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # 1. List empty sessions
    res = await client.get(
        f"/workspaces/{workspace_id}/sessions",
        headers=auth_headers(token),
    )
    assert res.status_code == 200
    assert res.json() == []

    # 2. Create session with direct notes/summary
    payload = {
        "title": "Sprint Planning Meeting",
        "source": "notes",
        "transcript": "Jordan: Let's ship Phase 5 today.\nSam: On it!",
        "ai_summary": "Team agreed to ship Phase 5 today.",
        "action_items": ["Ship Phase 5 sessions pipeline"],
    }
    create_res = await client.post(
        f"/workspaces/{workspace_id}/sessions",
        headers=auth_headers(token),
        json=payload,
    )
    assert create_res.status_code == 201
    data = create_res.json()
    assert data["title"] == "Sprint Planning Meeting"
    assert data["status"] == "done"
    assert len(data["action_items"]) == 1
    session_id = data["id"]

    # 3. Get session by ID
    get_res = await client.get(
        f"/workspaces/{workspace_id}/sessions/{session_id}",
        headers=auth_headers(token),
    )
    assert get_res.status_code == 200
    assert get_res.json()["title"] == "Sprint Planning Meeting"

    # 4. Update session
    update_res = await client.patch(
        f"/workspaces/{workspace_id}/sessions/{session_id}",
        headers=auth_headers(token),
        json={"title": "Sprint Planning - Final", "action_items": ["Ship Phase 5", "Run tests"]},
    )
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["title"] == "Sprint Planning - Final"
    assert len(updated["action_items"]) == 2

    # 5. Delete session
    del_res = await client.delete(
        f"/workspaces/{workspace_id}/sessions/{session_id}",
        headers=auth_headers(token),
    )
    assert del_res.status_code == 204

    # 6. Confirm deleted
    get_after_del = await client.get(
        f"/workspaces/{workspace_id}/sessions/{session_id}",
        headers=auth_headers(token),
    )
    assert get_after_del.status_code == 404


@pytest.mark.asyncio
async def test_session_audio_upload_and_pipeline_execution(
    client: AsyncClient,
    auth_context: dict,
    db_session,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # 1. Upload audio recording file
    dummy_audio = io.BytesIO(b"RIFF....WAVEfmt ....data....fake-audio-bytes")
    files = {"file": ("meeting_recording.webm", dummy_audio, "audio/webm")}
    data = {"title": "Architecture Deep Dive"}

    upload_res = await client.post(
        f"/workspaces/{workspace_id}/sessions/upload",
        headers=auth_headers(token),
        files=files,
        data=data,
    )
    assert upload_res.status_code == 202
    session_data = upload_res.json()
    assert session_data["title"] == "Architecture Deep Dive"
    assert session_data["status"] == "uploading"
    assert session_data["file_path"] is not None
    session_id = uuid.UUID(session_data["id"])

    # 2. Execute background processing pipeline
    await process_session_pipeline(session_id, uuid.UUID(workspace_id), db=db_session)


    # 3. Retrieve processed session
    get_res = await client.get(
        f"/workspaces/{workspace_id}/sessions/{session_id}",
        headers=auth_headers(token),
    )
    assert get_res.status_code == 200
    processed = get_res.json()
    assert processed["status"] == SessionStatus.DONE
    assert processed["transcript"] is not None
    assert len(processed["transcript"]) > 0
    assert processed["ai_summary"] is not None
    assert isinstance(processed["action_items"], list)
    assert len(processed["action_items"]) > 0


@pytest.mark.asyncio
async def test_session_workspace_scoping_and_security(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Create session in User 1's workspace
    create_res = await client.post(
        f"/workspaces/{workspace_id}/sessions",
        headers=auth_headers(token),
        json={"title": "Confidential Session"},
    )
    assert create_res.status_code == 201
    session_id = create_res.json()["id"]

    # Register User 2
    user2_res = await client.post(
        "/auth/register",
        json={"email": "outsider_session@example.com", "password": "securepass123", "name": "Outsider"},
    )
    assert user2_res.status_code == 201
    user2_token = user2_res.json()["access_token"]

    # User 2 attempts to get User 1's session -> 404 access denied
    denied_res = await client.get(
        f"/workspaces/{workspace_id}/sessions/{session_id}",
        headers=auth_headers(user2_token),
    )
    assert denied_res.status_code == 404
