import pytest
from httpx import AsyncClient


async def _register(client: AsyncClient, email: str, name: str) -> str:
    response = await client.post(
        "/auth/register",
        json={"email": email, "password": "securepass123", "name": name},
    )
    assert response.status_code == 201
    return response.json()["access_token"]


@pytest.mark.asyncio
async def test_registration_creates_personal_workspace(client: AsyncClient) -> None:
    token = await _register(client, "owner@example.com", "Owner")

    response = await client.get(
        "/workspaces",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    workspaces = response.json()
    assert len(workspaces) == 1
    assert workspaces[0]["type"] == "personal"
    assert workspaces[0]["join_code"] is None


@pytest.mark.asyncio
async def test_create_and_join_team_workspace(client: AsyncClient) -> None:
    owner_token = await _register(client, "teamowner@example.com", "Team Owner")
    member_token = await _register(client, "teammember@example.com", "Team Member")

    create_response = await client.post(
        "/workspaces",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"name": "Engineering"},
    )
    assert create_response.status_code == 201
    team_workspace = create_response.json()
    assert team_workspace["type"] == "team"
    assert team_workspace["join_code"] is not None

    join_response = await client.post(
        "/workspaces/join",
        headers={"Authorization": f"Bearer {member_token}"},
        json={"join_code": team_workspace["join_code"]},
    )
    assert join_response.status_code == 200
    assert join_response.json()["id"] == team_workspace["id"]

    member_workspaces = await client.get(
        "/workspaces",
        headers={"Authorization": f"Bearer {member_token}"},
    )
    workspace_ids = {workspace["id"] for workspace in member_workspaces.json()}
    assert team_workspace["id"] in workspace_ids


@pytest.mark.asyncio
async def test_get_workspace_detail(client: AsyncClient) -> None:
    token = await _register(client, "detail@example.com", "Detail User")

    list_response = await client.get(
        "/workspaces",
        headers={"Authorization": f"Bearer {token}"},
    )
    workspace_id = list_response.json()[0]["id"]

    detail_response = await client.get(
        f"/workspaces/{workspace_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert detail["id"] == workspace_id
    assert len(detail["members"]) == 1
    assert detail["members"][0]["role"] == "owner"


@pytest.mark.asyncio
async def test_join_invalid_code(client: AsyncClient) -> None:
    token = await _register(client, "joiner@example.com", "Joiner")

    response = await client.post(
        "/workspaces/join",
        headers={"Authorization": f"Bearer {token}"},
        json={"join_code": "INVALID1"},
    )
    assert response.status_code == 404
