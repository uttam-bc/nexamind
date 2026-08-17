import pytest
from httpx import AsyncClient


@pytest.fixture
async def auth_context(client: AsyncClient) -> dict:
    response = await client.post(
        "/auth/register",
        json={
            "email": "docuser@example.com",
            "password": "securepass123",
            "name": "Doc User",
        },
    )
    assert response.status_code == 201
    data = response.json()
    workspaces = await client.get(
        "/workspaces",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    return {
        "token": data["access_token"],
        "user_id": data["user"]["id"],
        "workspace_id": workspaces.json()[0]["id"],
    }


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


SAMPLE_BLOCKS = {
    "blocks": [
        {"id": "block-1", "type": "heading", "level": 1, "text": "Project Spec"},
        {
            "id": "block-2",
            "type": "paragraph",
            "text": "This document tracks requirements for NexaMind.",
        },
        {
            "id": "block-3",
            "type": "bullet_list",
            "items": ["Auth", "Workspaces", "Documents"],
        },
    ]
}


@pytest.mark.asyncio
async def test_create_document_with_blocks(client: AsyncClient, auth_context: dict) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    response = await client.post(
        f"/workspaces/{workspace_id}/documents",
        headers=auth_headers(token),
        json={"title": "Project Spec", "content": SAMPLE_BLOCKS},
    )
    assert response.status_code == 201
    document = response.json()
    assert document["title"] == "Project Spec"
    assert document["content"]["blocks"][0]["text"] == "Project Spec"
    assert document["created_by"] == auth_context["user_id"]


@pytest.mark.asyncio
async def test_list_and_get_documents(client: AsyncClient, auth_context: dict) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    create_response = await client.post(
        f"/workspaces/{workspace_id}/documents",
        headers=auth_headers(token),
        json={"title": "Notes"},
    )
    document_id = create_response.json()["id"]

    list_response = await client.get(
        f"/workspaces/{workspace_id}/documents",
        headers=auth_headers(token),
    )
    assert list_response.status_code == 200
    assert len(list_response.json()) == 1
    assert list_response.json()[0]["title"] == "Notes"

    get_response = await client.get(
        f"/workspaces/{workspace_id}/documents/{document_id}",
        headers=auth_headers(token),
    )
    assert get_response.status_code == 200
    assert get_response.json()["content"] == {"blocks": []}


@pytest.mark.asyncio
async def test_update_document(client: AsyncClient, auth_context: dict) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    create_response = await client.post(
        f"/workspaces/{workspace_id}/documents",
        headers=auth_headers(token),
        json={"title": "Draft"},
    )
    document_id = create_response.json()["id"]

    update_response = await client.patch(
        f"/workspaces/{workspace_id}/documents/{document_id}",
        headers=auth_headers(token),
        json={"title": "Final Draft", "content": SAMPLE_BLOCKS},
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["title"] == "Final Draft"
    assert len(updated["content"]["blocks"]) == 3


@pytest.mark.asyncio
async def test_delete_document(client: AsyncClient, auth_context: dict) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    create_response = await client.post(
        f"/workspaces/{workspace_id}/documents",
        headers=auth_headers(token),
        json={"title": "Temporary"},
    )
    document_id = create_response.json()["id"]

    delete_response = await client.delete(
        f"/workspaces/{workspace_id}/documents/{document_id}",
        headers=auth_headers(token),
    )
    assert delete_response.status_code == 204

    get_response = await client.get(
        f"/workspaces/{workspace_id}/documents/{document_id}",
        headers=auth_headers(token),
    )
    assert get_response.status_code == 404


@pytest.mark.asyncio
async def test_document_access_requires_workspace_membership(client: AsyncClient) -> None:
    owner = await client.post(
        "/auth/register",
        json={"email": "owner@example.com", "password": "securepass123", "name": "Owner"},
    )
    owner_token = owner.json()["access_token"]
    workspace_id = (
        await client.get("/workspaces", headers=auth_headers(owner_token))
    ).json()[0]["id"]

    create_response = await client.post(
        f"/workspaces/{workspace_id}/documents",
        headers=auth_headers(owner_token),
        json={"title": "Private Doc"},
    )
    document_id = create_response.json()["id"]

    outsider = await client.post(
        "/auth/register",
        json={"email": "outsider@example.com", "password": "securepass123", "name": "Outsider"},
    )
    outsider_token = outsider.json()["access_token"]

    response = await client.get(
        f"/workspaces/{workspace_id}/documents/{document_id}",
        headers=auth_headers(outsider_token),
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_team_member_can_access_shared_documents(client: AsyncClient) -> None:
    owner = await client.post(
        "/auth/register",
        json={"email": "teamowner@example.com", "password": "securepass123", "name": "Team Owner"},
    )
    owner_token = owner.json()["access_token"]

    team_response = await client.post(
        "/workspaces",
        headers=auth_headers(owner_token),
        json={"name": "Shared Team"},
    )
    team_workspace = team_response.json()

    create_response = await client.post(
        f"/workspaces/{team_workspace['id']}/documents",
        headers=auth_headers(owner_token),
        json={"title": "Team Notes", "content": SAMPLE_BLOCKS},
    )
    document_id = create_response.json()["id"]

    member = await client.post(
        "/auth/register",
        json={"email": "teammember@example.com", "password": "securepass123", "name": "Team Member"},
    )
    member_token = member.json()["access_token"]

    await client.post(
        "/workspaces/join",
        headers=auth_headers(member_token),
        json={"join_code": team_workspace["join_code"]},
    )

    response = await client.get(
        f"/workspaces/{team_workspace['id']}/documents/{document_id}",
        headers=auth_headers(member_token),
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Team Notes"
