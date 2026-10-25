"""Video calls started from a direct message: ringing, access for both people, decline, summary line."""

import pytest
from httpx import AsyncClient

from app.services.websocket_manager import ws_manager
from tests.conftest import auth_headers


async def _user(client: AsyncClient, email: str, name: str, username: str) -> dict:
    resp = await client.post("/auth/register", json={"email": email, "password": "securepass123", "name": name,
                                                     "username": username})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    headers = auth_headers(body["access_token"])
    wid = (await client.get("/workspaces", headers=headers)).json()[0]["id"]
    return {"headers": headers, "id": body["user"]["id"], "wid": wid}


@pytest.fixture
def frames(monkeypatch) -> list:
    sent = []

    async def capture(user_id, event):
        sent.append((str(user_id), event))

    monkeypatch.setattr(ws_manager, "send_to_user", capture)
    return sent


@pytest.mark.asyncio
async def test_call_rings_the_other_person_who_can_join_from_another_workspace(client: AsyncClient, frames) -> None:
    asha = await _user(client, "asha@example.com", "Asha", "asha")
    priya = await _user(client, "priya@example.com", "Priya", "priya")
    zed = await _user(client, "zed@example.com", "Zed", "zed")
    dm = (await client.post(f"/workspaces/{asha['wid']}/channels/dm", headers=asha["headers"],
                            json={"target_username": "priya"})).json()

    started = await client.post(f"/workspaces/{asha['wid']}/channels/{dm['id']}/call", headers=asha["headers"],
                                json={"client_request_id": "call-click-0001"})
    assert started.status_code == 201, started.text
    call = started.json()["call"]
    assert call["status"] == "live" and call["is_host"] and call["title"] == "Call: Asha & Priya"
    rings = [e for uid, e in frames if e.get("event") == "ring"]
    assert len(rings) == 1 and frames[0][0] == priya["id"] and rings[0]["caller"]["name"] == "Asha"

    # Pressing again joins the running call instead of starting a second one.
    again = await client.post(f"/workspaces/{asha['wid']}/channels/{dm['id']}/call", headers=asha["headers"], json={})
    assert again.status_code == 200 and again.json()["call"]["id"] == call["id"]
    live = (await client.get(f"/workspaces/{priya['wid']}/channels/{dm['id']}/call", headers=priya["headers"])).json()
    assert live["call"]["id"] == call["id"]

    # Priya isn't a member of Asha's workspace, but the call is hers too; Zed can't see it.
    path = f"/workspaces/{call['workspace_id']}/meetings/{call['id']}"
    mine = await client.get(path, headers=priya["headers"])
    assert mine.status_code == 200 and mine.json()["is_host"]
    assert (await client.get(path, headers=zed["headers"])).status_code == 404
    listed = (await client.get(f"/workspaces/{asha['wid']}/meetings", headers=asha["headers"])).json()
    assert any(m["id"] == call["id"] for m in (listed if isinstance(listed, list) else listed.get("meetings", [])))

    # Ending it tells both apps, and the conversation gets a line about it.
    ended = await client.post(f"{path}/end", headers=priya["headers"], json={"scope": "all"})
    assert ended.status_code == 200 and ended.json()["session_id"] is None  # nothing was said: no minutes
    assert {uid for uid, e in frames if e.get("event") == "ended"} == {asha["id"], priya["id"]}
    messages = (await client.get(f"/workspaces/{asha['wid']}/channels/{dm['id']}/messages", headers=asha["headers"])).json()
    assert messages[-1]["content"] == "📞 Missed video call"


@pytest.mark.asyncio
async def test_declining_ends_a_two_person_call(client: AsyncClient, frames) -> None:
    asha = await _user(client, "asha@example.com", "Asha", "asha")
    priya = await _user(client, "priya@example.com", "Priya", "priya")
    dm = (await client.post(f"/workspaces/{asha['wid']}/channels/dm", headers=asha["headers"],
                            json={"target_username": "priya"})).json()
    call = (await client.post(f"/workspaces/{asha['wid']}/channels/{dm['id']}/call", headers=asha["headers"], json={})).json()["call"]
    resp = await client.post(f"/workspaces/{call['workspace_id']}/meetings/{call['id']}/decline", headers=priya["headers"])
    assert resp.status_code == 200 and resp.json()["meeting"]["status"] == "ended"
    declined = [e for uid, e in frames if e.get("event") == "declined"]
    assert declined and declined[0]["name"] == "Priya"
    assert (await client.get(f"/workspaces/{priya['wid']}/channels/{dm['id']}/call", headers=priya["headers"])).json()["call"] is None


@pytest.mark.asyncio
async def test_calls_only_start_from_direct_messages(client: AsyncClient, auth_context: dict) -> None:
    headers = auth_headers(auth_context["token"])
    ws = (await client.post("/workspaces", headers=headers, json={"name": "Team"})).json()
    channel = (await client.post(f"/workspaces/{ws['id']}/channels", headers=headers, json={"name": "general"})).json()
    resp = await client.post(f"/workspaces/{ws['id']}/channels/{channel['id']}/call", headers=headers, json={})
    assert resp.status_code == 400
