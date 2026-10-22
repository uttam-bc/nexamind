"""Single entry point for calls to Google Gemini and Groq.

API keys are sent in request headers (never in URLs, which end up in logs), models come from
settings, and every function returns None instead of raising when a provider is unavailable,
so callers can fall back to offline behaviour.
"""

import json
import logging
import time
from typing import Any

import httpx

from app.config import get_settings
from app.security import decrypt_secret

logger = logging.getLogger(__name__)

GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
DEFAULT_TIMEOUT = httpx.Timeout(connect=10.0, read=45.0, write=30.0, pool=10.0)

# Models that just failed with overload (429/5xx) or a timeout are skipped for a while, so the next
# call goes straight to a model that is working instead of waiting on the same failure again.
MODEL_COOLDOWN_SECONDS = 60.0
_model_unavailable_until: dict[str, float] = {}


def _available_models(models: list[str]) -> list[str]:
    now = time.monotonic()
    healthy = [m for m in models if _model_unavailable_until.get(m, 0.0) <= now]
    # If every model is cooling down, try them all rather than failing without asking.
    return healthy or list(models)


def _mark_unavailable(model: str) -> None:
    _model_unavailable_until[model] = time.monotonic() + MODEL_COOLDOWN_SECONDS


def reset_model_health() -> None:
    _model_unavailable_until.clear()
# Successful Gemini responses per model, for diagnostics and evaluation reports.
MODEL_USAGE: dict[str, int] = {}


class LlmKeyError(Exception):
    """The provider rejected the API key."""


def resolve_gemini_key(user: Any | None = None) -> str | None:
    """A user's own stored key wins over the server-wide key."""
    if user is not None:
        personal = decrypt_secret(getattr(user, "gemini_api_key_encrypted", None))
        if personal:
            return personal
    key = (get_settings().gemini_api_key or "").strip()
    return key or None


def groq_key() -> str | None:
    key = (get_settings().groq_api_key or "").strip()
    return key or None


def _redact(text: str, key: str | None) -> str:
    return text.replace(key, "***") if key else text


async def gemini_generate(
    api_key: str | None,
    contents: list[dict],
    *,
    system: str | None = None,
    tools: list[dict] | None = None,
    generation_config: dict | None = None,
    timeout: httpx.Timeout = DEFAULT_TIMEOUT,
) -> dict | None:
    """Call generateContent, trying each configured model. Returns the first candidate or None.

    Raises LlmKeyError when Google rejects the key, so callers can tell the user.
    """
    if not api_key:
        return None
    payload: dict[str, Any] = {"contents": contents}
    if system:
        payload["systemInstruction"] = {"parts": [{"text": system}]}
    if tools:
        payload["tools"] = [{"functionDeclarations": tools}]
    if generation_config:
        payload["generationConfig"] = generation_config

    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        for model in _available_models(get_settings().gemini_models):
            try:
                res = await client.post(f"{GEMINI_BASE_URL}/models/{model}:generateContent", json=payload, headers=headers)
            except httpx.HTTPError as exc:
                logger.warning("Gemini %s request failed: %s", model, exc.__class__.__name__)
                _mark_unavailable(model)
                continue
            if res.status_code == 200:
                candidates = res.json().get("candidates") or []
                if candidates and candidates[0].get("content"):
                    MODEL_USAGE[model] = MODEL_USAGE.get(model, 0) + 1
                    return candidates[0]
                logger.warning("Gemini %s returned no content (finishReason=%s)", model,
                               candidates[0].get("finishReason") if candidates else None)
                continue
            body = _redact(res.text[:300], api_key)
            if res.status_code in (401, 403) or (res.status_code == 400 and "API_KEY" in body):
                raise LlmKeyError("Gemini rejected the API key")
            if res.status_code == 429 or res.status_code >= 500:
                _mark_unavailable(model)
            logger.warning("Gemini %s returned HTTP %d: %s", model, res.status_code, body)
    return None


def candidate_text(candidate: dict | None) -> str:
    if not candidate:
        return ""
    parts = candidate.get("content", {}).get("parts") or []
    return "".join(p.get("text", "") for p in parts if isinstance(p, dict)).strip()


async def gemini_text(
    api_key: str | None,
    prompt: str,
    *,
    system: str | None = None,
    json_mode: bool = False,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    extra_parts: list[dict] | None = None,
) -> str | None:
    config: dict[str, Any] = {"temperature": temperature, "maxOutputTokens": max_tokens}
    if json_mode:
        config["responseMimeType"] = "application/json"
    parts = [{"text": prompt}, *(extra_parts or [])]
    try:
        candidate = await gemini_generate(api_key, [{"role": "user", "parts": parts}], system=system, generation_config=config)
    except LlmKeyError:
        return None
    return candidate_text(candidate) or None


async def gemini_embed(api_key: str | None, texts: list[str], task_type: str = "RETRIEVAL_DOCUMENT") -> list[list[float]] | None:
    if not api_key or not texts:
        return None
    model = get_settings().gemini_embedding_model
    payload = {
        "requests": [
            {"model": f"models/{model}", "content": {"parts": [{"text": t[:8000]}]}, "taskType": task_type}
            for t in texts
        ]
    }
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            res = await client.post(
                f"{GEMINI_BASE_URL}/models/{model}:batchEmbedContents",
                json=payload,
                headers={"x-goog-api-key": api_key},
            )
    except httpx.HTTPError as exc:
        logger.warning("Gemini embedding request failed: %s", exc.__class__.__name__)
        return None
    if res.status_code != 200:
        logger.warning("Gemini embedding returned HTTP %d: %s", res.status_code, _redact(res.text[:200], api_key))
        return None
    embeddings = res.json().get("embeddings") or []
    vectors = [e.get("values") for e in embeddings]
    return vectors if len(vectors) == len(texts) and all(vectors) else None


async def groq_chat(
    messages: list[dict],
    *,
    tools: list[dict] | None = None,
    json_mode: bool = False,
    temperature: float = 0.2,
    max_tokens: int = 2048,
) -> dict | None:
    """Returns the assistant message dict (may contain tool_calls) or None."""
    key = groq_key()
    if not key:
        return None
    body: dict[str, Any] = {
        "model": get_settings().groq_chat_model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if tools:
        body["tools"] = [{"type": "function", "function": t} for t in tools]
        body["tool_choice"] = "auto"
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            res = await client.post(
                f"{GROQ_BASE_URL}/chat/completions",
                json=body,
                headers={"Authorization": f"Bearer {key}"},
            )
    except httpx.HTTPError as exc:
        logger.warning("Groq request failed: %s", exc.__class__.__name__)
        return None
    if res.status_code != 200:
        logger.warning("Groq returned HTTP %d: %s", res.status_code, _redact(res.text[:200], key))
        return None
    choices = res.json().get("choices") or []
    return choices[0].get("message") if choices else None


async def groq_text(prompt: str, *, system: str | None = None, json_mode: bool = False) -> str | None:
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    message = await groq_chat(messages, json_mode=json_mode)
    content = (message or {}).get("content")
    return content.strip() if content else None


async def groq_transcribe(file_path: str, filename: str, mime_type: str) -> str | None:
    key = groq_key()
    if not key:
        return None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=180.0, write=120.0, pool=10.0)) as client:
            with open(file_path, "rb") as f:
                res = await client.post(
                    f"{GROQ_BASE_URL}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {key}"},
                    files={"file": (filename, f, mime_type)},
                    data={"model": get_settings().groq_transcription_model},
                )
    except httpx.HTTPError as exc:
        logger.warning("Groq transcription failed: %s", exc.__class__.__name__)
        return None
    if res.status_code != 200:
        logger.warning("Groq transcription returned HTTP %d: %s", res.status_code, _redact(res.text[:200], key))
        return None
    return (res.json().get("text") or "").strip() or None


async def complete_text(
    prompt: str,
    *,
    system: str | None = None,
    json_mode: bool = False,
    gemini_key: str | None = None,
) -> str | None:
    """Try Gemini, then Groq. Returns None when neither is configured or both fail."""
    text = await gemini_text(gemini_key or resolve_gemini_key(), prompt, system=system, json_mode=json_mode)
    if text:
        return text
    return await groq_text(prompt, system=system, json_mode=json_mode)


def parse_json(text: str | None) -> Any:
    """Parse model JSON output, tolerating ```json fences."""
    if not text:
        return None
    clean = text.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[1] if "\n" in clean else clean[3:]
        clean = clean.rsplit("```", 1)[0]
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        return None
