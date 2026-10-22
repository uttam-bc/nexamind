"""Copilot conversation history and document reading/editing (with a mocked model)."""

import pytest
from httpx import AsyncClient

from app.services import llm_client

from .conftest import auth_headers


async def _no_embeddings(*_args, **_kwargs):
    return None


def _script(monkeypatch, steps):
    """Fake Gemini: each step is a function(contents) -> list of parts. Records every request."""
    seen = []

    async def fake_generate(api_key, contents, *, system=None, tools=None, generation_config=None, **_):
        if not tools:  # memory extraction, not the copilot loop
            return {"content": {"role": "model", "parts": [{"text": "[]"}]}}
        seen.append({"contents": contents, "system": system})
        parts = steps[min(len(seen) - 1, len(steps) - 1)](contents)
        return {"content": {"role": "model", "parts": parts}}

    monkeypatch.setattr(llm_client, "resolve_gemini_key", lambda user=None: "test-key")
    monkeypatch.setattr(llm_client, "gemini_generate", fake_generate)
    monkeypatch.setattr(llm_client, "gemini_embed", _no_embeddings)
    return seen


def _call(name, **args):
    return [{"functionCall": {"name": name, "args": args}}]


def _text(value):
    return [{"text": value}]


def _tool_reply(contents):
    return contents[-1]["parts"][0]["functionResponse"]["response"]


async def _doc(client, ctx, title, text):
    resp = await client.post(f"/workspaces/{ctx['workspace_id']}/documents", headers=auth_headers(ctx["token"]),
                             json={"title": title, "content": {"text": text}})
    assert resp.status_code == 201
    return resp.json()


async def _chat(client, ctx, prompt, session_id=None):
    body = {"prompt": prompt}
    if session_id:
        body["session_id"] = session_id
    resp = await client.post(f"/workspaces/{ctx['workspace_id']}/ai/chat", headers=auth_headers(ctx["token"]), json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_history_is_kept_and_sent_back_to_the_model(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    seen = _script(monkeypatch, [lambda c: _text("Nice to meet you, Sam."), lambda c: _text("Your name is Sam.")])
    first = await _chat(client, auth_context, "My name is Sam")
    second = await _chat(client, auth_context, "What is my name?", first["session_id"])
    assert second["session_id"] == first["session_id"]

    # The second request carried the first exchange as history.
    texts = [p.get("text") for turn in seen[1]["contents"] for p in turn["parts"]]
    assert texts[:3] == ["My name is Sam", "Nice to meet you, Sam.", "What is my name?"]

    # And the saved conversation can be reloaded in order.
    ws, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    history = (await client.get(f"/workspaces/{ws}/ai/sessions/{first['session_id']}", headers=headers)).json()
    assert [(m["role"], m["content"]) for m in history] == [
        ("user", "My name is Sam"), ("assistant", "Nice to meet you, Sam."),
        ("user", "What is my name?"), ("assistant", "Your name is Sam."),
    ]
    sessions = (await client.get(f"/workspaces/{ws}/ai/sessions", headers=headers)).json()
    assert [s["id"] for s in sessions] == [first["session_id"]]


@pytest.mark.asyncio
async def test_copilot_reads_a_document(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    doc = await _doc(client, auth_context, "Launch Plan", "# Launch\n\nWe ship on Friday the 14th.")
    seen = _script(monkeypatch, [
        lambda c: _call("get_document", doc_query=doc["id"]),
        lambda c: _text("It ships on Friday the 14th." if "Friday the 14th" in _tool_reply(c)["content"] else "unknown"),
    ])
    reply = await _chat(client, auth_context, "When do we ship according to the launch plan?")
    assert reply["response"] == "It ships on Friday the 14th."
    assert f"Launch Plan (id {doc['id']})" in seen[0]["system"]


@pytest.mark.asyncio
@pytest.mark.parametrize("mode,args,expected", [
    ("replace_text", {"find_text": "Friday", "new_content_text": "Monday"}, "# Launch\n\nWe ship on Monday."),
    ("append", {"new_content_text": "- Owner: Sam"}, "# Launch\n\nWe ship on Friday.\n\n- Owner: Sam"),
    ("prepend", {"new_content_text": "DRAFT"}, "DRAFT\n\n# Launch\n\nWe ship on Friday."),
    ("replace", {"new_content_text": "# New plan"}, "# New plan"),
])
async def test_copilot_edits_a_document(client: AsyncClient, auth_context: dict, monkeypatch, mode, args, expected) -> None:
    doc = await _doc(client, auth_context, "Launch Plan", "# Launch\n\nWe ship on Friday.")
    _script(monkeypatch, [lambda c: _call("edit_document", doc_query="Launch Plan", mode=mode, **args),
                          lambda c: _text(_tool_reply(c).get("message") or _tool_reply(c).get("error"))])
    reply = await _chat(client, auth_context, "update the launch plan")
    assert reply["response"].startswith("Updated document 'Launch Plan'")

    ws, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    stored = (await client.get(f"/workspaces/{ws}/documents/{doc['id']}", headers=headers)).json()
    assert stored["content"]["text"] == expected
    assert "blocks" not in stored["content"]


@pytest.mark.asyncio
async def test_edit_refuses_missing_text_and_ambiguous_titles(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    await _doc(client, auth_context, "Plan A", "alpha")
    await _doc(client, auth_context, "Plan B", "beta")
    _script(monkeypatch, [lambda c: _call("edit_document", doc_query="Plan", new_content_text="x"),
                          lambda c: _text(_tool_reply(c)["error"])])
    reply = await _chat(client, auth_context, "edit the plan")
    assert "Several documents match 'Plan'" in reply["response"]

    _script(monkeypatch, [lambda c: _call("edit_document", doc_query="Plan A", mode="replace_text",
                                          find_text="gamma", new_content_text="x"),
                          lambda c: _text(_tool_reply(c)["error"])])
    reply = await _chat(client, auth_context, "fix plan a")
    assert "was not found in 'Plan A'" in reply["response"]


@pytest.mark.asyncio
async def test_documents_created_by_copilot_open_normally(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    _script(monkeypatch, [lambda c: _call("create_document", title="Retro notes", content_text="## Wins\n\n- Shipped"),
                          lambda c: _call("get_document", doc_query="Retro notes"),
                          lambda c: _text(_tool_reply(c)["content"])])
    reply = await _chat(client, auth_context, "write retro notes and read them back")
    # Read back exactly once (older versions stored the body twice and returned it duplicated).
    assert reply["response"] == "## Wins\n\n- Shipped"


@pytest.mark.asyncio
async def test_overloaded_model_is_skipped_on_the_next_call(monkeypatch) -> None:
    """A model that answers 503 is not retried first again; the next call goes to the fallback."""
    import httpx

    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "gemini_models", ["busy-model", "backup-model"])
    hits = []

    def handler(request: httpx.Request) -> httpx.Response:
        model = request.url.path.split("/models/")[1].split(":")[0]
        hits.append(model)
        if model == "busy-model":
            return httpx.Response(503, json={"error": {"status": "UNAVAILABLE"}})
        return httpx.Response(200, json={"candidates": [{"content": {"role": "model", "parts": [{"text": "ok"}]}}]})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    contents = [{"role": "user", "parts": [{"text": "hi"}]}]
    assert llm_client.candidate_text(await llm_client.gemini_generate("k", contents)) == "ok"
    assert llm_client.candidate_text(await llm_client.gemini_generate("k", contents)) == "ok"
    assert hits == ["busy-model", "backup-model", "backup-model"]


@pytest.mark.asyncio
async def test_copilot_places_an_image_in_a_document(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    ws, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    png = bytes([0x89]) + b"PNG" + bytes([13, 10, 26, 10]) + b"rest"
    logo = (await client.post(f"/workspaces/{ws}/files", headers=headers,
                              files={"file": ("team-photo.png", png, "image/png")})).json()
    doc = await _doc(client, auth_context, "About us", "# About us")

    _script(monkeypatch, [
        lambda c: _call("list_files", images_only=True, query="team"),
        lambda c: _call("edit_document", doc_query=doc["id"], mode="append",
                        new_content_text=_tool_reply(c)["files"][0]["markdown"]),
        lambda c: _text(_tool_reply(c)["message"]),
    ])
    reply = await _chat(client, auth_context, "add the team photo to the About us page")
    assert [t["tool"] for t in reply["tool_calls"]] == ["list_files", "edit_document"]
    stored = (await client.get(f"/workspaces/{ws}/documents/{doc['id']}", headers=headers)).json()
    assert stored["content"]["text"] == f"# About us\n\n![team-photo](file:{logo['id']})"


@pytest.mark.asyncio
async def test_copilot_edits_an_uploaded_word_file_through_its_page(client: AsyncClient, auth_context: dict, monkeypatch) -> None:
    from tests.test_document_import import _docx

    ws, headers = auth_context["workspace_id"], auth_headers(auth_context["token"])
    upload = (await client.post(f"/workspaces/{ws}/files", headers=headers,
                                files={"file": ("Launch Plan.docx", _docx(), "application/octet-stream")})).json()
    _script(monkeypatch, [
        lambda c: _call("edit_document", doc_query="Launch Plan", mode="replace_text", find_text="Friday", new_content_text="Monday"),
        lambda c: _text(_tool_reply(c)["message"]),
    ])
    await _chat(client, auth_context, "move the launch to Monday in Launch Plan")
    # The page and the Word download both show the change.
    page = (await client.get(f"/workspaces/{ws}/documents/{upload['document_id']}", headers=headers)).json()
    assert "We ship on **Monday**" in page["content"]["text"]
    export = await client.get(f"/workspaces/{ws}/documents/{upload['document_id']}/export?format=docx", headers=headers)
    from app.services.document_import import docx_to_markdown
    assert "We ship on **Monday**" in docx_to_markdown(export.content)
