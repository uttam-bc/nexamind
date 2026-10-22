"""NX-SEC-006: members may only delete shared content they created; owners/admins may delete anything."""

import pytest
from httpx import AsyncClient

from tests.conftest import auth_headers

RESOURCES = {
    "document": ("/documents", {"title": "Doc"}, "/documents/{id}"),
    "task": ("/tasks", {"title": "Task"}, "/tasks/{id}"),
    "transaction": ("/finance/transactions",
                    {"type": "expense", "amount": 10, "category": "Ops", "date": "2026-10-01T00:00:00"},
                    "/finance/transactions/{id}"),
    "event": ("/calendar/events", {"title": "Sync", "event_date": "2026-10-30"}, "/calendar/events/{id}"),
}


@pytest.fixture
async def team(client: AsyncClient, auth_context: dict) -> dict:
    owner = auth_headers(auth_context["token"])
    ws = await client.post("/workspaces", headers=owner, json={"name": "Team", "type": "team"})
    assert ws.status_code == 201, ws.text
    reg = await client.post("/auth/register", json={"email": "member@example.com", "password": "securepass123", "name": "Member"})
    member = auth_headers(reg.json()["access_token"])
    assert (await client.post("/workspaces/join", headers=member, json={"join_code": ws.json()["join_code"]})).status_code == 200
    return {"wid": ws.json()["id"], "owner": owner, "member": member}


async def _create(client: AsyncClient, team: dict, kind: str, who: str) -> str:
    path, body, _ = RESOURCES[kind]
    resp = await client.post(f"/workspaces/{team['wid']}{path}", headers=team[who], json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", list(RESOURCES))
async def test_member_cannot_delete_others_content(client: AsyncClient, team: dict, kind: str) -> None:
    item = await _create(client, team, kind, "owner")
    url = f"/workspaces/{team['wid']}" + RESOURCES[kind][2].format(id=item)
    assert (await client.delete(url, headers=team["member"])).status_code == 403
    assert (await client.delete(url, headers=team["owner"])).status_code == 204


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", list(RESOURCES))
async def test_author_and_admin_can_delete_member_content(client: AsyncClient, team: dict, kind: str) -> None:
    own = await _create(client, team, kind, "member")
    other = await _create(client, team, kind, "member")
    base = f"/workspaces/{team['wid']}" + RESOURCES[kind][2]
    assert (await client.delete(base.format(id=own), headers=team["member"])).status_code == 204
    assert (await client.delete(base.format(id=other), headers=team["owner"])).status_code == 204
