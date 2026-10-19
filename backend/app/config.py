import json
import logging
from functools import lru_cache

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

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
        if isinstance(v, str) and v.startswith("postgres://"):
            v = v.replace("postgres://", "postgresql://", 1)
        if isinstance(v, str) and v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+asyncpg://", 1)
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
    gemini_models: list[str] = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-flash"]
    gemini_embedding_model: str = "gemini-embedding-001"
    groq_chat_model: str = "llama-3.3-70b-versatile"
    groq_transcription_model: str = "whisper-large-v3-turbo"
    agent_max_tool_rounds: int = 6
    # Background work: memory re-extraction after edits and recording transcription.
    # Tests turn this off and drive the jobs directly.
    run_background_jobs: bool = True

    # Uploads
    upload_dir: str = "uploads"
    max_upload_mb: int = 25
    max_recording_mb: int = 200

    # Real-time fan-out across multiple API instances (optional)
    redis_url: str | None = None

    # Rate limiting (per client IP, per window)
    rate_limit_enabled: bool = True
    rate_limit_auth_per_minute: int = 10
    rate_limit_ai_per_minute: int = 20

    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8081",
        "http://127.0.0.1:8081",
    ]

    @field_validator("cors_origins", "gemini_models", mode="before")
    @classmethod
    def parse_list(cls, v: object) -> list[str]:
        if isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            except json.JSONDecodeError:
                pass
            return [item.strip() for item in v.split(",") if item.strip()]
        if isinstance(v, list):
            return [str(item).strip() for item in v]
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
        return self


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.jwt_secret_key == INSECURE_DEFAULT_SECRET:
        logger.warning("Using the insecure default JWT secret. Set JWT_SECRET_KEY before deploying.")
    return settings
