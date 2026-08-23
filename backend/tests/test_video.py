import pytest
from httpx import AsyncClient


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_create_join_and_end_video_room_with_ai_summary(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # 1. Start a live video room
    room_payload = {"name": "Sprint 5 Standup & Planning"}
    start_res = await client.post(
        f"/workspaces/{workspace_id}/video/rooms",
        headers=auth_headers(token),
        json=room_payload,
    )
    assert start_res.status_code == 201
    room = start_res.json()
    room_id = room["room_id"]
    assert room["name"] == "Sprint 5 Standup & Planning"
    assert room["status"] == "active"
    assert "daily.co" in room["room_url"]
    assert len(room["participants"]) == 1

    # 2. List active video rooms
    list_res = await client.get(
        f"/workspaces/{workspace_id}/video/rooms",
        headers=auth_headers(token),
    )
    assert list_res.status_code == 200
    assert len(list_res.json()) >= 1
    assert any(r["room_id"] == room_id for r in list_res.json())

    # 3. Join video room
    join_res = await client.post(
        f"/workspaces/{workspace_id}/video/rooms/{room_id}/join",
        headers=auth_headers(token),
    )
    assert join_res.status_code == 200
    assert join_res.json()["room_id"] == room_id

    # 4. End video room with meeting notes & generate AI summary
    end_payload = {
        "notes": (
            "Alex: We completed all 7 backend phases.\n"
            "Sam: Action item: Prepare frontend client. Alex to verify test coverage.\n"
            "Jordan: Excellent sprint!"
        )
    }
    end_res = await client.post(
        f"/workspaces/{workspace_id}/video/rooms/{room_id}/end",
        headers=auth_headers(token),
        json=end_payload,
    )
    assert end_res.status_code == 200
    session = end_res.json()
    assert "Sprint 5 Standup & Planning" in session["title"]
    assert session["source"] == "live"
    assert session["status"] == "done"
    assert session["ai_summary"] is not None
    assert len(session["action_items"]) > 0

    # 5. Verify room is no longer in active rooms list
    after_list_res = await client.get(
        f"/workspaces/{workspace_id}/video/rooms",
        headers=auth_headers(token),
    )
    assert after_list_res.status_code == 200
    assert not any(r["room_id"] == room_id for r in after_list_res.json())


@pytest.mark.asyncio
async def test_video_room_access_control(
    client: AsyncClient,
    auth_context: dict,
) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # Start room
    start_res = await client.post(
        f"/workspaces/{workspace_id}/video/rooms",
        headers=auth_headers(token),
        json={"name": "Confidential Board Meeting"},
    )
    assert start_res.status_code == 201
    room_id = start_res.json()["room_id"]

    # Register outsider user
    user2_res = await client.post(
        "/auth/register",
        json={"email": "outsider_video@example.com", "password": "securepass123", "name": "Outsider"},
    )
    assert user2_res.status_code == 201
    user2_token = user2_res.json()["access_token"]

    # Outsider cannot join room -> 404 Access Denied
    join_res = await client.post(
        f"/workspaces/{workspace_id}/video/rooms/{room_id}/join",
        headers=auth_headers(user2_token),
    )
    assert join_res.status_code == 404
