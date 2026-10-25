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
async def test_code_repo_commits_are_real_and_issues_are_numbered(client: AsyncClient, auth_context: dict) -> None:
    workspace_id = auth_context["workspace_id"]
    headers = auth_headers(auth_context["token"])
    repo = (await client.post(f"/workspaces/{workspace_id}/repos", headers=headers,
                              json={"name": "nexamind-backend", "description": "FastAPI Core Backend"})).json()
    repo_id = repo["id"]
    assert repo["name"] == "nexamind-backend" and repo["commit_count"] == 1
    assert len((await client.get(f"/workspaces/{workspace_id}/repos", headers=headers)).json()) == 1

    # A commit can't be "logged" with a made-up hash any more: it must change files.
    fake = await client.post(f"/workspaces/{workspace_id}/repos/{repo_id}/commits", headers=headers,
                             json={"message": "feat: add projects module", "hash": "abc123456789"})
    assert fake.status_code == 422
    real = await client.post(f"/workspaces/{workspace_id}/repos/{repo_id}/commits", headers=headers, json={
        "branch": "main", "message": "feat: add projects module",
        "changes": [{"op": "put", "path": "projects.py", "content": "pass\n"}]})
    assert real.status_code == 201 and len(real.json()["sha"]) == 40
    log = (await client.get(f"/workspaces/{workspace_id}/repos/{repo_id}/commits", headers=headers)).json()
    assert log["commits"][0]["sha"] == real.json()["sha"]

    issue = (await client.post(f"/workspaces/{workspace_id}/repos/{repo_id}/issues", headers=headers,
                               json={"title": "Fix JWT token expiration bug"})).json()
    assert issue["number"] == 1 and issue["state"] == "open"
    closed = await client.patch(f"/workspaces/{workspace_id}/repos/{repo_id}/issues/1", headers=headers, json={"state": "closed"})
    assert closed.status_code == 200 and closed.json()["state"] == "closed"
