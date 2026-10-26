"""Audit findings D8 and D12: secrets must not travel in URLs or logs, or end up in the container image."""

import logging
from pathlib import Path

import httpx
import pytest

from app.services import llm_client

KEY = "AIzaTEST-secret-key-0123456789"


def _patch_transport(monkeypatch, handler) -> list[httpx.Request]:
    seen: list[httpx.Request] = []
    real_client = httpx.AsyncClient

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    monkeypatch.setattr(llm_client.httpx, "AsyncClient",
                        lambda *a, **kw: real_client(*a, transport=httpx.MockTransport(recording), **kw))
    llm_client.reset_model_health()
    return seen


@pytest.mark.asyncio
async def test_d8_model_key_is_sent_in_a_header_never_in_the_url(monkeypatch) -> None:
    seen = _patch_transport(monkeypatch, lambda r: httpx.Response(
        200, json={"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}))
    result = await llm_client.gemini_generate(KEY, [{"role": "user", "parts": [{"text": "hi"}]}])
    assert result is not None and seen
    for request in seen:
        assert KEY not in str(request.url)
        assert request.headers["x-goog-api-key"] == KEY


@pytest.mark.asyncio
async def test_d8_model_key_is_redacted_from_error_logs(monkeypatch, caplog) -> None:
    # A provider error that echoes the key back must not write it to the server log.
    _patch_transport(monkeypatch, lambda r: httpx.Response(500, text=f"internal error for key {KEY}"))
    with caplog.at_level(logging.DEBUG):
        await llm_client.gemini_generate(KEY, [{"role": "user", "parts": [{"text": "hi"}]}])
    assert caplog.records, "the failure should be logged"
    assert KEY not in caplog.text


def test_d12_container_build_excludes_secrets_and_data() -> None:
    ignore = (Path(__file__).resolve().parent.parent / ".dockerignore").read_text(encoding="utf-8").split()
    for pattern in (".env", ".env.*", "*.db", "uploads/", "repos/"):
        assert pattern in ignore, f"{pattern} must not be copied into the image"
    assert "!.env.example" in ignore
