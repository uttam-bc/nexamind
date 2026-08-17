import pytest
from httpx import AsyncClient


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_channels_and_messages(client: AsyncClient, auth_context: dict) -> None:
    workspace_id = auth_context["workspace_id"]
    token = auth_context["token"]

    # List channels (should auto-create default 'general' channel)
    channels_res = await client.get(
        f"/workspaces/{workspace_id}/channels",
        headers=auth_headers(token),
    )
    assert channels_res.status_code == 200
    channels = channels_res.json()
    assert len(channels) >= 1
    general_channel = next(c for c in channels if c["name"] == "general")
    general_id = general_channel["id"]

    # Create new channel 'engineering'
    create_chan_res = await client.post(
        f"/workspaces/{workspace_id}/channels",
        headers=auth_headers(token),
        json={"name": "engineering", "description": "Tech discussions", "is_private": False},
    )
    assert create_chan_res.status_code == 201
    eng_channel = create_chan_res.json()
    eng_id = eng_channel["id"]
    assert eng_channel["name"] == "engineering"

    # Post message in engineering channel
    msg_res = await client.post(
        f"/workspaces/{workspace_id}/channels/{eng_id}/messages",
        headers=auth_headers(token),
        json={"content": "Welcome to NexaMind Engineering!"},
    )
    assert msg_res.status_code == 201
    msg = msg_res.json()
    assert msg["content"] == "Welcome to NexaMind Engineering!"
    assert msg["channel_id"] == eng_id

    # List messages in engineering channel
    get_msgs_res = await client.get(
        f"/workspaces/{workspace_id}/channels/{eng_id}/messages",
        headers=auth_headers(token),
    )
    assert get_msgs_res.status_code == 200
    msgs = get_msgs_res.json()
    assert len(msgs) == 1
    assert msgs[0]["content"] == "Welcome to NexaMind Engineering!"
