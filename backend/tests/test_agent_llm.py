"""Copilot behaviour with a (mocked) LLM, and offline safety without one."""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient

from app.services import llm_client
from app.services.agent_planner import plan, parse_date

from .conftest import auth_headers


@pytest.mark.asyncio
async def test_gemini_tool_loop_executes_model_chosen_tools(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    calls = []

    async def fake_generate(api_key, contents, *, system=None, tools=None, generation_config=None, **_):
        calls.append(contents)
        if len(calls) == 1:
            assert tools and any(t["name"] == "create_task" for t in tools)
            assert "untrusted" in system
            return {"content": {"role": "model", "parts": [
                {"functionCall": {"name": "create_task", "args": {"title": "Write launch blog post", "priority": "high"}}},
            ]}}
        tool_reply = contents[-1]["parts"][0]["functionResponse"]
        assert tool_reply["name"] == "create_task"
        assert tool_reply["response"]["title"] == "Write launch blog post"
        return {"content": {"role": "model", "parts": [{"text": "Added **Write launch blog post** to the board."}]}}

    monkeypatch.setattr(llm_client, "resolve_gemini_key", lambda user=None: "test-key")
    monkeypatch.setattr(llm_client, "gemini_generate", fake_generate)
    monkeypatch.setattr(llm_client, "gemini_embed", _no_embeddings)

    ws, token = auth_context["workspace_id"], auth_context["token"]
    res = await client.post(f"/workspaces/{ws}/ai/chat", headers=auth_headers(token),
                            json={"prompt": "I need to remember to write the launch blog post, it's important"})
    data = res.json()
    assert data["response"] == "Added **Write launch blog post** to the board."
    assert [t["tool"] for t in data["tool_calls"]] == ["create_task"]

    tasks = (await client.get(f"/workspaces/{ws}/tasks", headers=auth_headers(token))).json()
    assert [(t["title"], t["priority"]) for t in tasks] == [("Write launch blog post", "high")]


@pytest.mark.asyncio
async def test_tool_errors_are_reported_to_the_model_not_raised(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    async def fake_generate(api_key, contents, **_):
        if len(contents) == 1:
            return {"content": {"role": "model", "parts": [
                {"functionCall": {"name": "update_task_status", "args": {"task_id": "not-a-uuid", "status": "done"}}},
            ]}}
        error = contents[-1]["parts"][0]["functionResponse"]["response"]["error"]
        return {"content": {"role": "model", "parts": [{"text": f"Sorry: {error}"}]}}

    monkeypatch.setattr(llm_client, "resolve_gemini_key", lambda user=None: "test-key")
    monkeypatch.setattr(llm_client, "gemini_generate", fake_generate)
    monkeypatch.setattr(llm_client, "gemini_embed", _no_embeddings)

    res = await client.post(f"/workspaces/{auth_context['workspace_id']}/ai/chat",
                            headers=auth_headers(auth_context["token"]), json={"prompt": "mark it done"})
    assert res.status_code == 200
    assert "not a valid task id" in res.json()["response"]


@pytest.mark.asyncio
async def test_rejected_key_is_explained_and_offline_mode_still_works(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    async def reject(*_, **__):
        raise llm_client.LlmKeyError("bad key")

    monkeypatch.setattr(llm_client, "resolve_gemini_key", lambda user=None: "bad-key")
    monkeypatch.setattr(llm_client, "gemini_generate", reject)
    monkeypatch.setattr(llm_client, "gemini_embed", _no_embeddings)

    res = await client.post(f"/workspaces/{auth_context['workspace_id']}/ai/chat",
                            headers=auth_headers(auth_context["token"]), json={"prompt": "create task 'Rotate keys'"})
    body = res.json()
    assert "Gemini API key was rejected" in body["response"]
    assert [t["tool"] for t in body["tool_calls"]] == ["create_task"]


@pytest.mark.asyncio
async def test_offline_mode_never_invents_actions(client: AsyncClient, auth_context: dict) -> None:
    ws, token = auth_context["workspace_id"], auth_context["token"]
    for prompt in ["I don't want to create a task", "make a new channel", "add a task", "what should we do next?"]:
        res = await client.post(f"/workspaces/{ws}/ai/chat", headers=auth_headers(token), json={"prompt": prompt})
        assert res.status_code == 200
        assert res.json()["tool_calls"] == [], prompt
    assert (await client.get(f"/workspaces/{ws}/tasks", headers=auth_headers(token))).json() == []


def test_planner_relative_dates() -> None:
    today = date(2026, 10, 20)  # a Tuesday
    assert parse_date("tomorrow", today) == "2026-10-21"
    assert parse_date("next monday", today) == "2026-10-26"
    assert parse_date("in 3 days", today) == (today + timedelta(days=3)).isoformat()
    assert parse_date("on 2027-01-05", today) == "2027-01-05"
    assert parse_date("sometime", today) is None


def test_planner_keeps_quoted_text_intact() -> None:
    calls = plan("create task 'Don't break prod; and test it' and log income of $1,200 for Consulting").calls
    assert [(c.tool, c.args.get("title") or c.args.get("amount")) for c in calls] == [
        ("create_task", "Don't break prod; and test it"),
        ("create_transaction", 1200.0),
    ]


async def _no_embeddings(*_, **__):
    return None
