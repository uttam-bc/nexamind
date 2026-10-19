"""Cross-cutting security helpers: rate limiting, response headers, and secret encryption."""

import base64
import hashlib
import time
from collections import defaultdict, deque

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, Request, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.config import get_settings


class RateLimiter:
    """Sliding-window limiter kept in process memory.

    Limits apply per API instance; put a shared limiter (e.g. at the proxy) in front
    when running several instances.
    """

    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str, limit: int, window_seconds: float = 60.0) -> None:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and hits[0] <= now - window_seconds:
            hits.popleft()
        if len(hits) >= limit:
            retry_after = max(1, int(window_seconds - (now - hits[0])))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please slow down and try again shortly.",
                headers={"Retry-After": str(retry_after)},
            )
        hits.append(now)
        if len(self._hits) > 50_000:
            self._evict(now, window_seconds)

    def _evict(self, now: float, window_seconds: float) -> None:
        for key in [k for k, v in self._hits.items() if not v or v[-1] <= now - window_seconds]:
            del self._hits[key]

    def reset(self) -> None:
        self._hits.clear()


rate_limiter = RateLimiter()


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _limit(bucket: str, limit_attr: str):
    async def dependency(request: Request) -> None:
        settings = get_settings()
        if settings.rate_limit_enabled:
            rate_limiter.check(f"{bucket}:{client_ip(request)}", getattr(settings, limit_attr))

    return dependency


limit_auth = _limit("auth", "rate_limit_auth_per_minute")
limit_ai = _limit("ai", "rate_limit_ai_per_minute")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp, enable_hsts: bool = False) -> None:
        super().__init__(app)
        self.enable_hsts = enable_hsts

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "geolocation=()")
        if not request.url.path.startswith(("/docs", "/redoc")):
            response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if self.enable_hsts:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response


def _fernet() -> Fernet:
    settings = get_settings()
    material = settings.data_encryption_key or f"nexamind-data-key:{settings.jwt_secret_key}"
    key = base64.urlsafe_b64encode(hashlib.sha256(material.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return None
