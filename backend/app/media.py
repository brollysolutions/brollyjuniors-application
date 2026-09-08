"""
Protected media delivery.

The rule from requirement 35: a recording or PDF must not be reachable just
because someone knows a URL. So:

  1. Object keys are content-addressed (sha256), which makes them unguessable
     AND immutable — a URL never goes stale, so every asset can be cached for a
     year with no invalidation logic anywhere.
  2. No row anywhere stores a usable URL. What is stored is a storage key.
  3. A usable link is a SHORT-LIVED SIGNATURE minted per request, and only
     after the caller's entitlement has been checked.

The signer below is HMAC over the same fields a CDN signature covers, so
swapping in CloudFront or Cloudflare is a change to this file alone. Nothing
that calls it knows or cares which CDN is behind it.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

from .config import settings


class MediaSigner(Protocol):
    def sign(self, storage_key: str, for_user_id: str, ttl_seconds: int) -> tuple[str, datetime]: ...
    def verify(self, storage_key: str, expires: int, signature: str, for_user_id: str) -> bool: ...


class HmacSigner:
    """
    Development signer. Same shape as a CDN signature: key + expiry + audience,
    so the swap is mechanical.

    Binding the signature to a user id is a deliberate step past what most CDN
    signed URLs do — a leaked link is useless to anybody else. A real
    CloudFront deployment gets the same effect with signed cookies plus a short
    TTL; the limitation is noted rather than glossed over.
    """

    def sign(self, storage_key: str, for_user_id: str, ttl_seconds: int) -> tuple[str, datetime]:
        expires = int(time.time()) + ttl_seconds
        sig = self._mac(storage_key, expires, for_user_id)
        url = f"{settings.cdn_base}/{storage_key}?expires={expires}&sig={sig}"
        return url, datetime.fromtimestamp(expires, tz=timezone.utc)

    def verify(self, storage_key: str, expires: int, signature: str, for_user_id: str) -> bool:
        if expires < int(time.time()):
            return False
        return hmac.compare_digest(self._mac(storage_key, expires, for_user_id), signature)

    def _mac(self, storage_key: str, expires: int, for_user_id: str) -> str:
        digest = hmac.new(
            settings.media_signing_key.encode("utf-8"),
            f"{storage_key}\n{expires}\n{for_user_id}".encode("utf-8"),
            hashlib.sha256,
        ).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


media_signer: MediaSigner = HmacSigner()


def sign_asset(asset: dict[str, Any], for_user_id: str) -> dict[str, Any]:
    """Turn a media_asset row into something the browser can actually fetch."""
    # Public assets (a course hero image) need no signature and cache forever.
    if asset.get("visibility") == "public":
        return {
            "url": f"{settings.cdn_base}/{asset['storage_key']}",
            "expiresAt": (datetime.now(timezone.utc) + timedelta(days=365)).isoformat(),
            "kind": asset.get("kind"),
            "mimeType": asset.get("mime_type"),
            "bytes": asset.get("bytes"),
            "durationMs": asset.get("duration_ms"),
            "fileName": asset.get("file_name", ""),
        }

    url, expires_at = media_signer.sign(
        asset["storage_key"], for_user_id, settings.media_url_ttl_seconds
    )
    return {
        "url": url,
        "expiresAt": expires_at.isoformat(),
        "kind": asset.get("kind"),
        "mimeType": asset.get("mime_type"),
        "bytes": asset.get("bytes"),
        "durationMs": asset.get("duration_ms"),
        "fileName": asset.get("file_name", ""),
    }


def storage_key_for(sha256_hex: str, file_name: str) -> str:
    """Content-addressed key: identical bytes are stored once, and never move."""
    safe = re.sub(r"[^a-z0-9.]+", "-", file_name.lower()).strip("-")
    return f"media/{sha256_hex[:2]}/{sha256_hex}/{safe}"
