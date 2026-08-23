import pytest
from httpx import AsyncClient


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_calendar_event_crud_and_detection(
    client: AsyncClient,
    auth_context: dict,
):
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # 1. Create a calendar event
    create_res = await client.post(
        f"/workspaces/{workspace_id}/calendar/events",
        headers=auth_headers(token),
        json={
            "title": "Q3 Architecture Review & Sprint Demo",
            "description": "Evaluate WebSocket performance and WebRTC stability",
            "event_date": "2026-08-28",
            "event_time": "03:30 PM",
            "event_type": "meeting",
            "priority": "high",
        },
    )
    assert create_res.status_code == 201
    event = create_res.json()
    assert event["title"] == "Q3 Architecture Review & Sprint Demo"
    assert event["event_date"] == "2026-08-28"
    assert event["event_type"] == "meeting"
    event_id = event["id"]

    # 2. List calendar events
    list_res = await client.get(
        f"/workspaces/{workspace_id}/calendar/events",
        headers=auth_headers(token),
    )
    assert list_res.status_code == 200
    events = list_res.json()
    assert len(events) >= 1
    assert any(e["id"] == event_id for e in events)

    # 3. Update calendar event (mark completed)
    patch_res = await client.patch(
        f"/workspaces/{workspace_id}/calendar/events/{event_id}",
        headers=auth_headers(token),
        json={"is_completed": True, "priority": "urgent"},
    )
    assert patch_res.status_code == 200
    updated = patch_res.json()
    assert updated["is_completed"] is True
    assert updated["priority"] == "urgent"

    # 4. Test AI Reminder Detection endpoint
    detect_res = await client.post(
        f"/workspaces/{workspace_id}/calendar/detect-reminders",
        headers=auth_headers(token),
    )
    assert detect_res.status_code == 200
    detect_data = detect_res.json()
    assert "reminders" in detect_data
    assert "count" in detect_data

    # 5. Delete calendar event
    del_res = await client.delete(
        f"/workspaces/{workspace_id}/calendar/events/{event_id}",
        headers=auth_headers(token),
    )
    assert del_res.status_code == 204
