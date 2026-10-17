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
    # Post threaded reply to message
    root_msg_id = msg["id"]
    reply_res = await client.post(
        f"/workspaces/{workspace_id}/channels/{eng_id}/messages",
        headers=auth_headers(token),
        json={"content": "Great to be here!", "parent_id": root_msg_id},
    )
    assert reply_res.status_code == 201
    reply = reply_res.json()
    assert reply["parent_id"] == root_msg_id
    assert reply["content"] == "Great to be here!"

    # List thread replies
    thread_res = await client.get(
        f"/workspaces/{workspace_id}/channels/{eng_id}/messages?parent_id={root_msg_id}",
        headers=auth_headers(token),
    )
    assert thread_res.status_code == 200
    thread_msgs = thread_res.json()
    assert len(thread_msgs) == 1
    assert thread_msgs[0]["id"] == reply["id"]

    # Toggle reaction on root message
    react_res = await client.post(
        f"/workspaces/{workspace_id}/channels/{eng_id}/messages/{root_msg_id}/reactions",
        headers=auth_headers(token),
        json={"emoji": "🚀"},
    )
    assert react_res.status_code == 200
    reactions = react_res.json()
    assert len(reactions) == 1
    assert reactions[0]["emoji"] == "🚀"
    assert reactions[0]["count"] == 1
    assert reactions[0]["has_reacted"] is True

    # Toggle reaction off
    react_off_res = await client.post(
        f"/workspaces/{workspace_id}/channels/{eng_id}/messages/{root_msg_id}/reactions",
        headers=auth_headers(token),
        json={"emoji": "🚀"},
    )
    assert react_off_res.status_code == 200
    reactions_off = react_off_res.json()
    assert len(reactions_off) == 0

    # Test unread channels endpoint
    unreads_res = await client.get(
        f"/workspaces/{workspace_id}/channels/unread",
        headers=auth_headers(token),
    )
    assert unreads_res.status_code == 200
    unreads = unreads_res.json()
    assert len(unreads) >= 1

    # Mark channel read
    mark_read_res = await client.post(
        f"/workspaces/{workspace_id}/channels/{eng_id}/read",
        headers=auth_headers(token),
    )
    assert mark_read_res.status_code == 200

