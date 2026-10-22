"""Optional error reporting (Sentry-compatible). Off unless SENTRY_DSN is set."""

import logging

logger = logging.getLogger(__name__)

SENSITIVE_HEADERS = {"authorization", "cookie", "set-cookie", "x-goog-api-key", "x-api-key"}


def scrub_event(event: dict, _hint: dict | None = None) -> dict:
    """Remove credentials and request bodies (passwords, OTP codes, document text) before sending."""
    request = event.get("request") or {}
    headers = request.get("headers")
    if isinstance(headers, dict):
        request["headers"] = {k: ("[removed]" if k.lower() in SENSITIVE_HEADERS else v) for k, v in headers.items()}
    for key in ("data", "cookies", "query_string"):
        request.pop(key, None)
    event.pop("user", None)
    return event


def init_monitoring(dsn: str | None, environment: str) -> bool:
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed; error reporting is off")
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        send_default_pii=False,
        traces_sample_rate=0.0,
        before_send=scrub_event,
    )
    logger.info("Error reporting enabled")
    return True
