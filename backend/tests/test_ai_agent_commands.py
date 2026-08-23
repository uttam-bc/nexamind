import pytest
from httpx import AsyncClient


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_ai_agent_file_creation_command(
    client: AsyncClient,
    auth_context: dict,
):
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # 1. Create file command
    res = await client.post(
        f"/workspaces/{workspace_id}/ai/chat",
        headers=auth_headers(token),
        json={"prompt": "create a file named deployment.txt with text 'Step 1: build image. Step 2: push to registry.'"},
    )
    assert res.status_code == 200
    data = res.json()
    assert "response" in data
    assert any(t["tool"] == "create_document" for t in data["tool_calls"])

    # Verify file was created in database
    docs_res = await client.get(
        f"/workspaces/{workspace_id}/documents",
        headers=auth_headers(token),
    )
    assert docs_res.status_code == 200
    docs = docs_res.json()
    assert any("deployment.txt" in d["title"] for d in docs)


@pytest.mark.asyncio
async def test_ai_agent_file_edit_command(
    client: AsyncClient,
    auth_context: dict,
):
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # 1. Create initial doc
    create_res = await client.post(
        f"/workspaces/{workspace_id}/documents",
        headers=auth_headers(token),
        json={"title": "system_specs.md", "content": {"text": "Initial system specs."}},
    )
    doc_id = create_res.json()["id"]

    # 2. Tell AI to edit the document
    res = await client.post(
        f"/workspaces/{workspace_id}/ai/chat",
        headers=auth_headers(token),
        json={"prompt": "edit document system_specs.md and add 'Added Redis Cache layer for speed.'"},
    )
    assert res.status_code == 200
    data = res.json()
    assert any(t["tool"] == "edit_document" for t in data["tool_calls"])

    # Verify document was updated by getting document detail
    doc_detail_res = await client.get(
        f"/workspaces/{workspace_id}/documents/{doc_id}",
        headers=auth_headers(token),
    )
    assert doc_detail_res.status_code == 200
    doc_detail = doc_detail_res.json()
    assert "Redis Cache" in str(doc_detail["content"])


@pytest.mark.asyncio
async def test_ai_agent_channel_send_message_command(
    client: AsyncClient,
    auth_context: dict,
):
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Tell AI to send message to channel
    res = await client.post(
        f"/workspaces/{workspace_id}/ai/chat",
        headers=auth_headers(token),
        json={"prompt": "send message 'Sprint review starts in 10 minutes' to channel general"},
    )
    assert res.status_code == 200
    data = res.json()
    assert any(t["tool"] == "post_channel_message" for t in data["tool_calls"])


@pytest.mark.asyncio
async def test_ai_agent_calendar_schedule_command(
    client: AsyncClient,
    auth_context: dict,
):
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Tell AI to schedule a meeting
    res = await client.post(
        f"/workspaces/{workspace_id}/ai/chat",
        headers=auth_headers(token),
        json={"prompt": "schedule meeting for 'Sprint 42 Retrospective' tomorrow at 3 PM"},
    )
    assert res.status_code == 200
    data = res.json()
    assert any(t["tool"] == "create_calendar_event" for t in data["tool_calls"])

    # Verify event on calendar endpoint
    cal_res = await client.get(
        f"/workspaces/{workspace_id}/calendar/events",
        headers=auth_headers(token),
    )
    assert cal_res.status_code == 200
    events = cal_res.json()
    assert any("Sprint 42 Retrospective" in e["title"] for e in events)


@pytest.mark.asyncio
async def test_ai_agent_switch_workspace_command(
    client: AsyncClient,
    auth_context: dict,
):
    token = auth_context["token"]
    solo_ws_id = auth_context["workspace_id"]

    # Create a team group workspace
    team_res = await client.post(
        "/workspaces",
        headers=auth_headers(token),
        json={"name": "Core Backend Group"},
    )
    assert team_res.status_code == 201
    group_ws_id = team_res.json()["id"]

    # In Solo workspace, ask AI to switch to the group workspace
    chat_res = await client.post(
        f"/workspaces/{solo_ws_id}/ai/chat",
        headers=auth_headers(token),
        json={"prompt": "switch to group workspace Core Backend Group"},
    )
    assert chat_res.status_code == 200
    data = chat_res.json()
    switch_tool = next((t for t in data["tool_calls"] if t["tool"] == "switch_workspace"), None)
    assert switch_tool is not None
    assert switch_tool["result"]["workspace_id"] == group_ws_id


@pytest.mark.asyncio
async def test_ai_agent_cross_workspace_file_access(
    client: AsyncClient,
    auth_context: dict,
):
    token = auth_context["token"]
    solo_ws_id = auth_context["workspace_id"]

    # 1. Create a team group workspace
    team_res = await client.post(
        "/workspaces",
        headers=auth_headers(token),
        json={"name": "Engineering Team"},
    )
    group_ws_id = team_res.json()["id"]

    # 2. Create a document in that group workspace
    await client.post(
        f"/workspaces/{group_ws_id}/documents",
        headers=auth_headers(token),
        json={
            "title": "group_architecture.md",
            "content": {"text": "Microservices event-driven spec for Engineering Team."},
        },
    )

    # 3. While in Solo workspace, ask AI to access the file in that group
    chat_res = await client.post(
        f"/workspaces/{solo_ws_id}/ai/chat",
        headers=auth_headers(token),
        json={"prompt": "access the file group_architecture.md from group Engineering Team"},
    )
    assert chat_res.status_code == 200
    data = chat_res.json()
    get_tool = next((t for t in data["tool_calls"] if t["tool"] == "get_document"), None)
    assert get_tool is not None
    assert "Engineering Team" in str(get_tool["result"].get("workspace_name", ""))
    assert "Microservices event-driven" in str(get_tool["result"].get("content", ""))
