import pytest
from httpx import AsyncClient


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_omni_agent_autonomous_document_creation(
    client: AsyncClient,
    auth_context: dict,
):
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Prompt agent to draft a document
    res = await client.post(
        f"/workspaces/{workspace_id}/ai/chat",
        headers=auth_headers(token),
        json={"prompt": "Please draft a new document named 'Realtime WebRTC Architecture' with WebRTC specs."},
    )
    assert res.status_code == 200
    data = res.json()
    assert "response" in data
    assert len(data["tool_calls"]) > 0
    tools_called = [t["tool"] for t in data["tool_calls"]]
    assert "create_document" in tools_called

    # Verify document exists in workspace
    docs_res = await client.get(
        f"/workspaces/{workspace_id}/documents",
        headers=auth_headers(token),
    )
    assert docs_res.status_code == 200
    docs = docs_res.json()
    assert any("Realtime WebRTC Architecture" in d["title"] for d in docs)


@pytest.mark.asyncio
async def test_omni_agent_autonomous_task_and_finance(
    client: AsyncClient,
    auth_context: dict,
):
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Compound instruction: task + finance
    res = await client.post(
        f"/workspaces/{workspace_id}/ai/chat",
        headers=auth_headers(token),
        json={"prompt": "Create an urgent task 'Optimize Database Indices' and log an expense of $450 for PostgreSQL Hosting."},
    )
    assert res.status_code == 200
    data = res.json()
    tools_called = [t["tool"] for t in data["tool_calls"]]
    assert "create_task" in tools_called
    assert "create_transaction" in tools_called

    # Verify task in Kanban
    tasks_res = await client.get(f"/workspaces/{workspace_id}/tasks", headers=auth_headers(token))
    assert tasks_res.status_code == 200
    tasks = tasks_res.json()
    assert any("Optimize Database Indices" in t["title"] for t in tasks)

    # Verify transaction in Finance
    fin_res = await client.get(f"/workspaces/{workspace_id}/finance/summary", headers=auth_headers(token))
    assert fin_res.status_code == 200
    summary = fin_res.json()
    assert summary["total_expenses"] >= 450.0


@pytest.mark.asyncio
async def test_omni_agent_autonomous_repo_and_channel(
    client: AsyncClient,
    auth_context: dict,
):
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Repo + Channel
    res = await client.post(
        f"/workspaces/{workspace_id}/ai/chat",
        headers=auth_headers(token),
        json={"prompt": "Create a new repo named 'nexamind-core' and create a new channel named 'dev-ops'."},
    )
    assert res.status_code == 200
    data = res.json()
    tools_called = [t["tool"] for t in data["tool_calls"]]
    assert "create_repo" in tools_called
    assert "create_channel" in tools_called

    # Verify repo
    repos_res = await client.get(f"/workspaces/{workspace_id}/repos", headers=auth_headers(token))
    assert repos_res.status_code == 200
    repos = repos_res.json()
    assert any("nexamind-core" in r["name"] for r in repos)

    # Verify channel
    chans_res = await client.get(f"/workspaces/{workspace_id}/channels", headers=auth_headers(token))
    assert chans_res.status_code == 200
    chans = chans_res.json()
    assert any("dev-ops" in c["name"] for c in chans)
