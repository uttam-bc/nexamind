import pytest
from httpx import AsyncClient


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_task_crud(client: AsyncClient, auth_context: dict) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # List empty tasks
    res = await client.get(f"/workspaces/{workspace_id}/tasks", headers=auth_headers(token))
    assert res.status_code == 200
    assert res.json() == []

    # Create task
    task_payload = {
        "title": "Design Database Schema",
        "description": "Create PostgreSQL tables for Phase 3",
        "status": "todo",
        "priority": "high",
        "position": 1.0,
    }
    create_res = await client.post(
        f"/workspaces/{workspace_id}/tasks",
        headers=auth_headers(token),
        json=task_payload,
    )
    assert create_res.status_code == 201
    task_data = create_res.json()
    assert task_data["title"] == "Design Database Schema"
    assert task_data["status"] == "todo"

    task_id = task_data["id"]

    # Get task by ID
    get_res = await client.get(
        f"/workspaces/{workspace_id}/tasks/{task_id}",
        headers=auth_headers(token),
    )
    assert get_res.status_code == 200
    assert get_res.json()["title"] == "Design Database Schema"

    # Update task status & position
    update_res = await client.patch(
        f"/workspaces/{workspace_id}/tasks/{task_id}",
        headers=auth_headers(token),
        json={"status": "in_progress", "position": 2.0},
    )
    assert update_res.status_code == 200
    assert update_res.json()["status"] == "in_progress"
    assert update_res.json()["position"] == 2.0

    # Delete task
    del_res = await client.delete(
        f"/workspaces/{workspace_id}/tasks/{task_id}",
        headers=auth_headers(token),
    )
    assert del_res.status_code == 204

    # Confirm deletion
    get_res_after = await client.get(
        f"/workspaces/{workspace_id}/tasks/{task_id}",
        headers=auth_headers(token),
    )
    assert get_res_after.status_code == 404


@pytest.mark.asyncio
async def test_code_repo_commits_and_issues(client: AsyncClient, auth_context: dict) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Create repo
    repo_res = await client.post(
        f"/workspaces/{workspace_id}/repos",
        headers=auth_headers(token),
        json={"name": "nexamind-backend", "description": "FastAPI Core Backend"},
    )
    assert repo_res.status_code == 201
    repo = repo_res.json()
    repo_id = repo["id"]
    assert repo["name"] == "nexamind-backend"

    # List repos
    list_repos_res = await client.get(
        f"/workspaces/{workspace_id}/repos",
        headers=auth_headers(token),
    )
    assert list_repos_res.status_code == 200
    assert len(list_repos_res.json()) == 1

    # Create commit
    commit_res = await client.post(
        f"/workspaces/{workspace_id}/repos/{repo_id}/commits",
        headers=auth_headers(token),
        json={"message": "feat: add projects module", "hash": "abc123456789"},
    )
    assert commit_res.status_code == 201
    commit = commit_res.json()
    assert commit["message"] == "feat: add projects module"
    assert commit["hash"] == "abc123456789"

    # List commits
    list_commits_res = await client.get(
        f"/workspaces/{workspace_id}/repos/{repo_id}/commits",
        headers=auth_headers(token),
    )
    assert list_commits_res.status_code == 200
    assert len(list_commits_res.json()) == 1

    # Create issue
    issue_res = await client.post(
        f"/workspaces/{workspace_id}/repos/{repo_id}/issues",
        headers=auth_headers(token),
        json={"title": "Fix JWT token expiration bug", "status": "open"},
    )
    assert issue_res.status_code == 201
    issue = issue_res.json()
    issue_id = issue["id"]
    assert issue["status"] == "open"

    # Update issue
    update_issue_res = await client.patch(
        f"/workspaces/{workspace_id}/repos/{repo_id}/issues/{issue_id}",
        headers=auth_headers(token),
        json={"status": "closed"},
    )
    assert update_issue_res.status_code == 200
    assert update_issue_res.json()["status"] == "closed"
