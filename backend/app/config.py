"""
Configuration.

Every value has a working default so the app runs straight after
`docker compose up`. Ports match docker-compose.yml: Postgres 5542, Redis 6579.
"""
from __future__ import annotations

from pathlib import Path
from typing import Literal

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
    # The Capacitor app is not served from web_origin — it is served off the
    # device, so to this API it is a separate origin that must be named
    # explicitly (a credentialed request cannot be answered with "*"). These
    # are the origins Capacitor uses: capacitor:// on iOS, https://localhost on
    # Android with androidScheme: 'https'. Comma-separated in the environment.
    mobile_origins: str = "capacitor://localhost,https://localhost,http://localhost"

    # --- postgres ----------------------------------------------------------
    database_url: str = "postgresql://brolly:brolly@127.0.0.1:5542/brolly_b2c"
    db_pool_min: int = 2
    db_pool_max: int = 10

    # --- redis -------------------------------------------------------------
    redis_url: str = "redis://127.0.0.1:6579/0"

    # --- auth --------------------------------------------------------------
    # Signing keys are generated on first boot and kept here so a restart does
    # not sign everyone out. Back these up, or mount them from a secrets store.
    key_dir: Path = BACKEND_ROOT / ".data" / "keys"
    access_token_ttl_seconds: int = 600          # 10 minutes
    refresh_token_days: int = 30
    staff_refresh_hours: int = 12
    cookie_name: str = "brolly_b2c_rt"
    # 'lax' is right while the browser is the only client: the page and the API
    # share an origin behind the Next proxy. The mobile app makes the same
    # cookie cross-site, and a cross-site cookie is only sent when it is
    # SameSite=None — which browsers accept only alongside Secure, so turning
    # this to 'none' means the API must be on HTTPS.
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    # --- media -------------------------------------------------------------
    # Where uploaded bytes actually live. Under .data, which compose already
    # mounts as a named volume, so files survive a rebuild for the same reason
    # the signing keys do. In production this is the one thing to point at a
    # bucket instead — see MediaStore in app/media.py.
    media_root: Path = BACKEND_ROOT / ".data" / "media"
    # Prefix for a usable media link. Left relative on purpose: the browser
    # reaches this API through the Next proxy on the same origin, and the
    # mobile app prefixes it with its configured API base (lib/platform.ts).
    # Point it at a CDN host once there is one.
    cdn_base: str = ""
    media_signing_key: str = "dev-only-media-key-change-me"
    media_url_ttl_seconds: int = 900
    # 25 MB. A syllabus or a set of notes is well under this; a lecture video
    # is not, and belongs in object storage rather than an upload form.
    media_max_upload_bytes: int = 25 * 1024 * 1024

    # --- payments ----------------------------------------------------------
    payment_provider: str = "mock"

    @property
    def is_prod(self) -> bool:
        return self.node_env == "production"

    @property
    def cookie_secure(self) -> bool:
        # SameSite=None without Secure is rejected outright, so asking for a
        # cross-site cookie is also asking for a secure one.
        return self.is_prod or self.cookie_samesite == "none"

    @property
    def allowed_origins(self) -> list[str]:
        origins = [self.web_origin]
        origins += [o.strip() for o in self.mobile_origins.split(",") if o.strip()]
        # dict.fromkeys rather than set(): order is stable, which makes the
        # boot log and any CORS debugging reproducible.
        return list(dict.fromkeys(origins))


settings = Settings()
