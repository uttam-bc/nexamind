import json
import logging
from functools import lru_cache
from typing import Annotated
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

logger = logging.getLogger(__name__)

INSECURE_DEFAULT_SECRET = "change-me-to-a-long-random-secret"
DEV_ENVIRONMENTS = {"development", "dev", "local", "test"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "NexaMind"
    app_env: str = "development"
    debug: bool = False

    host: str = "0.0.0.0"
    port: int = 8000

    database_url: str = "sqlite+aiosqlite:///./nexamind.db"
    # Create missing tables on startup. Convenient for local SQLite; production relies on Alembic.
    auto_create_schema: bool | None = None

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, v: str) -> str:
        if not isinstance(v, str):
            return v
        # Render / Heroku-style URLs
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://") :]
        parsed = urlparse(v)
        if parsed.scheme in {"postgresql", "postgresql+asyncpg"}:
            # asyncpg rejects libpq-only query params like sslmode=
            query = [
                (k, val)
                for k, val in parse_qsl(parsed.query, keep_blank_values=True)
                if k.lower() not in {"sslmode", "ssl", "channel_binding"}
            ]
            v = urlunparse(parsed._replace(query=urlencode(query)))
            if v.startswith("postgresql://"):
                v = "postgresql+asyncpg://" + v[len("postgresql://") :]
        return v

    jwt_secret_key: str = INSECURE_DEFAULT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60
    # Encrypts user-supplied secrets (e.g. personal Gemini keys) at rest. Falls back to a key
    # derived from JWT_SECRET_KEY, so rotating that secret makes stored keys unreadable.
    data_encryption_key: str | None = None

    # Server-wide AI provider keys (optional). Users may also store their own Gemini key.
    gemini_api_key: str | None = None
    groq_api_key: str | None = None
    # NoDecode: allow plain comma-separated or single URL env values (Render sets a plain URL).
    gemini_models: Annotated[list[str], NoDecode] = [
        "gemini-flash-latest",
        "gemini-flash-lite-latest",
        "gemini-2.5-flash",
    ]
    gemini_embedding_model: str = "gemini-embedding-001"
    groq_chat_model: str = "openai/gpt-oss-120b"  # tool calling; llama-3.3-70b-versatile is no longer served to this key
    groq_transcription_model: str = "whisper-large-v3-turbo"
    agent_max_tool_rounds: int = 6
    # Background work: memory re-extraction after edits and recording transcription.
    # Tests turn this off and drive the jobs directly.
    run_background_jobs: bool = True

    # Email / SMTP configuration (e.g. Gmail SMTP, SendGrid, etc.)
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str = "noreply@nexamind.com"
    smtp_from_name: str = "NexaMind"
    smtp_tls: bool = True
    smtp_ssl: bool = False
    require_email_verification: bool = True

    # Google OAuth 2.0 Client ID (from Google Cloud Console). Google sign-in is disabled when unset.
    google_client_id: str | None = None

    # Local-only shortcuts: return OTP codes in API responses and accept `mock_google_:` credentials.
    # Refused at startup outside development/test so it can never reach production.
    enable_dev_auth: bool = False

    # How to find the real client IP behind proxies (used for rate limiting).
    # CLIENT_IP_HEADER names a header a trusted proxy sets and clients cannot forge
    # (e.g. "cf-connecting-ip" behind Cloudflare). TRUSTED_PROXY_HOPS counts proxies that append
    # to X-Forwarded-For. With neither, the socket peer address is used.
    client_ip_header: str | None = None
    trusted_proxy_hops: int = 0

    # Optional error monitoring (Sentry-compatible DSN). Disabled when unset.
    sentry_dsn: str | None = None

    # WebRTC ICE servers for meetings, as JSON or comma-separated URLs. TURN credentials are
    # supplied separately and never committed.
    webrtc_stun_urls: Annotated[list[str], NoDecode] = [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
    ]
    webrtc_turn_urls: Annotated[list[str], NoDecode] = []
    # Meetings are a peer-to-peer mesh: every participant sends its video to every other one,
    # so upload bandwidth and CPU grow with the number of people (see docs/OPERATIONS.md).
    max_meeting_participants: int = 8
    webrtc_turn_username: str | None = None
    webrtc_turn_credential: str | None = None

    # File storage: "local" (UPLOAD_DIR) or "s3" (any S3-compatible service, e.g. Cloudflare R2).
    storage_backend: str = "local"
    s3_bucket: str | None = None
    s3_endpoint_url: str | None = None
    s3_region: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None

    # Where contact-form messages are e-mailed (they are always stored in the database too).
    contact_inbox_email: str | None = None

    @property
    def smtp_configured(self) -> bool:
        return bool(self.smtp_host and self.smtp_user and self.smtp_password)

    @property
    def dev_auth_active(self) -> bool:
        return self.enable_dev_auth and self.is_development

    # Uploads
    upload_dir: str = "uploads"
    max_upload_mb: int = 25
    max_recording_mb: int = 200

    # Git repositories (bare repositories on local disk; backed up to the bucket with STORAGE_BACKEND=s3)
    repo_dir: str = "repos"
    git_binary: str = "git"
    repo_max_file_mb: int = 25  # one file added through the web
    repo_max_upload_mb: int = 300  # one upload batch (folder import) in total
    repo_max_upload_files: int = 5000
    git_max_push_mb: int = 300  # one `git push` (pack size, enforced by git and by the request body limit)
    git_timeout_seconds: int = 300

    # Real-time fan-out across multiple API instances (optional)
    redis_url: str | None = None

    # Rate limiting (per client IP, per window)
    rate_limit_enabled: bool = True
    rate_limit_auth_per_minute: int = 10
    rate_limit_ai_per_minute: int = 20

    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
    ]

    @field_validator("cors_origins", "gemini_models", "webrtc_stun_urls", "webrtc_turn_urls", mode="before")
    @classmethod
    def parse_list(cls, v: object) -> list[str]:
        if isinstance(v, str):
            text = v.strip()
            if not text:
                return []
            try:
                parsed = json.loads(text)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
                if isinstance(parsed, str) and parsed.strip():
                    return [parsed.strip()]
            except json.JSONDecodeError:
                pass
            return [item.strip() for item in text.split(",") if item.strip()]
        if isinstance(v, list):
            return [str(item).strip() for item in v if str(item).strip()]
        raise ValueError("Expected a list or a comma-separated string")

    log_level: str = "INFO"

    @property
    def is_development(self) -> bool:
        return self.app_env.lower() in DEV_ENVIRONMENTS

    @model_validator(mode="after")
    def validate_security(self) -> "Settings":
        if self.auto_create_schema is None:
            self.auto_create_schema = self.is_development
        if not self.jwt_secret_key.strip():
            self.jwt_secret_key = INSECURE_DEFAULT_SECRET
        weak_secret = self.jwt_secret_key == INSECURE_DEFAULT_SECRET or len(self.jwt_secret_key) < 32
        if weak_secret and not self.is_development:
            raise ValueError(
                "JWT_SECRET_KEY must be set to a random value of at least 32 characters "
                f"when APP_ENV={self.app_env!r}."
            )
        if self.jwt_algorithm not in {"HS256", "HS384", "HS512"}:
            raise ValueError("JWT_ALGORITHM must be one of HS256, HS384, HS512")
        if not self.is_development:
            if self.enable_dev_auth:
                raise ValueError("ENABLE_DEV_AUTH must not be enabled when APP_ENV is not development/test.")
            if self.debug:
                raise ValueError("DEBUG must be false when APP_ENV is not development/test.")
        if self.storage_backend not in {"local", "s3"}:
            raise ValueError("STORAGE_BACKEND must be 'local' or 's3'")
        if self.storage_backend == "s3" and not self.s3_bucket:
            raise ValueError("S3_BUCKET is required when STORAGE_BACKEND=s3")
        if self.trusted_proxy_hops < 0:
            raise ValueError("TRUSTED_PROXY_HOPS must be >= 0")
        return self


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.jwt_secret_key == INSECURE_DEFAULT_SECRET:
        logger.warning("Using the insecure default JWT secret. Set JWT_SECRET_KEY before deploying.")
    return settings
