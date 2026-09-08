"""
Configuration.

Every value has a working default so the app runs straight after
`docker compose up`. Ports match docker-compose.yml: Postgres 5542, Redis 6479.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- api ---------------------------------------------------------------
    port: int = 8000
    host: str = "127.0.0.1"
    node_env: str = "development"
    web_origin: str = "http://localhost:3000"

    # --- postgres ----------------------------------------------------------
    database_url: str = "postgresql://brolly:brolly@127.0.0.1:5542/brolly_b2c"
    db_pool_min: int = 2
    db_pool_max: int = 10

    # --- redis -------------------------------------------------------------
    redis_url: str = "redis://127.0.0.1:6479/0"

    # --- auth --------------------------------------------------------------
    # Signing keys are generated on first boot and kept here so a restart does
    # not sign everyone out. Back these up, or mount them from a secrets store.
    key_dir: Path = BACKEND_ROOT / ".data" / "keys"
    access_token_ttl_seconds: int = 600          # 10 minutes
    refresh_token_days: int = 30
    staff_refresh_hours: int = 12
    cookie_name: str = "brolly_b2c_rt"

    # --- media -------------------------------------------------------------
    cdn_base: str = "https://cdn.brollyjuniors.test"
    media_signing_key: str = "dev-only-media-key-change-me"
    media_url_ttl_seconds: int = 900

    # --- payments ----------------------------------------------------------
    payment_provider: str = "mock"

    @property
    def is_prod(self) -> bool:
        return self.node_env == "production"


settings = Settings()
