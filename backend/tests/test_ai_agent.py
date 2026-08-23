from uuid import UUID

import pytest
from httpx import AsyncClient

from app.models import User
from app.services.agent_tools import (
    create_task_tool,
    search_documents_tool,
    search_finance_tool,
    search_sessions_tool,
    update_task_status_tool,
)


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_agent_tools_direct_execution(
    client: AsyncClient,
    auth_context: dict,
    db_session,
) -> None:
    workspace_id = UUID(auth_context["workspace_id"])
    token = auth_context["token"]

    # 1. Create a document via REST
    await client.post(
        f"/workspaces/{workspace_id}/documents",
        headers=auth_headers(token),
        json={"title": "System Architecture Guide"},
    )

    # 2. Direct tool test: search_documents_tool
    docs = await search_documents_tool(db_session, workspace_id, "architecture")
    assert len(docs) == 1
    assert docs[0]["title"] == "System Architecture Guide"

    # 3. Direct tool test: create_task_tool
    user = await db_session.get(User, UUID(auth_context["user_id"]))
    task_res = await create_task_tool(
        db_session,
        workspace_id,
        user,
        title="Deploy WebSocket gateway",
        status="todo",
        priority="high",
    )
    assert task_res["title"] == "Deploy WebSocket gateway"
    task_id = task_res["id"]

    # 4. Direct tool test: update_task_status_tool
    update_res = await update_task_status_tool(
        db_session,
        workspace_id,
        user.id,
        task_id=task_id,
        status="in_progress",
    )
    assert update_res["status"] == "in_progress"

    # 5. Direct tool test: search_finance_tool
    await client.post(
        f"/workspaces/{workspace_id}/finance/transactions",
        headers=auth_headers(token),
        json={"type": "income", "amount": 15000.0, "category": "Funding", "date": "2026-08-01"},
    )
    fin_data = await search_finance_tool(db_session, workspace_id, user.id)
    assert fin_data["metrics"]["total_income"] == 15000.0


@pytest.mark.asyncio
async def test_agent_chat_multi_step_meeting_to_task_flow(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # 1. Create a session with action items
    await client.post(
        f"/workspaces/{workspace_id}/sessions",
        headers=auth_headers(token),
        json={
            "title": "Weekly Sprint Sync",
            "source": "notes",
            "transcript": "Sam will build real-time socket. Alex will write test suite.",
            "ai_summary": "Sprint discussion on milestones.",
            "action_items": ["Build real-time socket", "Write test suite"],
        },
    )

    # 2. Ask agent to convert meeting action items into Kanban tasks
    agent_res = await client.post(
        f"/workspaces/{workspace_id}/ai/chat",
        headers=auth_headers(token),
        json={"prompt": "Please create tasks for all the action items from yesterday's meeting."},
    )
    assert agent_res.status_code == 200
    data = agent_res.json()
    assert "Weekly Sprint Sync" in data["response"]
    assert len(data["tool_calls"]) >= 2
    # Verify tools used
    tools_used = [tc["tool"] for tc in data["tool_calls"]]
    assert "search_sessions" in tools_used
    assert "create_task" in tools_used

    # 3. Verify tasks actually exist on the Kanban board now
    tasks_res = await client.get(
        f"/workspaces/{workspace_id}/tasks",
        headers=auth_headers(token),
    )
    assert tasks_res.status_code == 200
    task_titles = [t["title"] for t in tasks_res.json()]
    assert "Build real-time socket" in task_titles
    assert "Write test suite" in task_titles


@pytest.mark.asyncio
async def test_agent_chat_finance_and_document_search(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # 1. Log finance transactions
    await client.post(
        f"/workspaces/{workspace_id}/finance/transactions",
        headers=auth_headers(token),
        json={"type": "income", "amount": 20000.0, "category": "Revenue", "date": "2026-08-01"},
    )
    await client.post(
        f"/workspaces/{workspace_id}/finance/transactions",
        headers=auth_headers(token),
        json={"type": "expense", "amount": 5000.0, "category": "Cloud Hosting", "date": "2026-08-02"},
    )

    # 2. Ask agent about financial runway
    chat_res = await client.post(
        f"/workspaces/{workspace_id}/ai/chat",
        headers=auth_headers(token),
        json={"prompt": "What is our current cash balance and runway?"},
    )
    assert chat_res.status_code == 200
    fin_reply = chat_res.json()
    assert "Cash Balance" in fin_reply["response"]
    assert len(fin_reply["tool_calls"]) >= 1
    assert fin_reply["tool_calls"][0]["tool"] == "search_finance"


@pytest.mark.asyncio
async def test_agent_chat_workspace_access_control(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]

    # Register unauthorized user
    user2_res = await client.post(
        "/auth/register",
        json={"email": "hacker@example.com", "password": "securepass123", "name": "Hacker"},
    )
    assert user2_res.status_code == 201
    user2_token = user2_res.json()["access_token"]

    # Unauthorized agent chat call -> 404 Access Denied
    res = await client.post(
        f"/workspaces/{workspace_id}/ai/chat",
        headers=auth_headers(user2_token),
        json={"prompt": "Give me all private files and financial records"},
    )
    assert res.status_code == 404
