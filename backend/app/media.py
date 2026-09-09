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
from pathlib import Path
from datetime import datetime, timezone
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
        # `u` is the audience the signature is bound to — the same field a CDN
        # signed URL carries. It has to travel in the link rather than in a
        # header, because the things that fetch these URLs are <video src>, an
        # <img>, and a PDF opened in a new tab, none of which can send one.
        audience = f"&u={for_user_id}" if for_user_id else ""
        url = f"{settings.cdn_base}/api/v1/media/{storage_key}?expires={expires}&sig={sig}{audience}"
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
    # A public asset (a course hero image) is signed with an empty audience and
    # a year to run: still unforgeable, but shareable and cacheable, which is
    # what "public" has to mean. A protected one is bound to the person who
    # asked for it, so a leaked link is useless to anybody else.
    public = asset.get("visibility") == "public"
    url, expires_at = media_signer.sign(
        asset["storage_key"],
        "" if public else for_user_id,
        365 * 86400 if public else settings.media_url_ttl_seconds,
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


# ---------------------------------------------------------------------------
# Where the bytes live
# ---------------------------------------------------------------------------

class MediaStore(Protocol):
    def write(self, storage_key: str, data: bytes) -> None: ...
    def open(self, storage_key: str) -> Path | None: ...


class LocalMediaStore:
    """
    Files on a disk the API can see — in compose, the .data volume.

    The seam is the same one HmacSigner sits behind: swapping this for S3 is a
    new class and one assignment below, not a change to anything that calls it.
    Nothing outside this file knows where a file physically is.
    """

    def __init__(self, root: Path) -> None:
        self._root = root

    def _resolve(self, storage_key: str) -> Path:
        # A storage key is built by storage_key_for() and never by a caller,
        # but this endpoint takes one off the wire, so it is checked anyway: a
        # key that escapes the root is refused rather than served.
        target = (self._root / storage_key).resolve()
        root = self._root.resolve()
        if root != target and root not in target.parents:
            raise ValueError("storage key escapes the media root")
        return target

    def write(self, storage_key: str, data: bytes) -> None:
        target = self._resolve(storage_key)
        target.parent.mkdir(parents=True, exist_ok=True)
        # Same bytes, same key: an identical upload is already stored, and
        # rewriting it would only risk truncating a file being read right now.
        if target.exists():
            return
        # Write beside the target and rename, so a reader never sees a file
        # that is half-written.
        tmp = target.with_name(target.name + ".part")
        tmp.write_bytes(data)
        tmp.replace(target)

    def open(self, storage_key: str) -> Path | None:
        try:
            target = self._resolve(storage_key)
        except ValueError:
            return None
        return target if target.is_file() else None


media_store: MediaStore = LocalMediaStore(settings.media_root)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


#: What an uploaded file is allowed to be. A whitelist, not a blacklist: a type
#: nobody thought about is refused rather than served back to a thirteen-year-old.
UPLOAD_TYPES: dict[str, str] = {
    "application/pdf": "pdf",
    "image/png": "image",
    "image/jpeg": "image",
    "image/gif": "image",
    "image/webp": "image",
    "text/plain": "doc",
    "text/markdown": "doc",
    "text/csv": "doc",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "doc",
    "application/vnd.ms-excel": "doc",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "doc",
    "application/vnd.ms-powerpoint": "slides",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "slides",
    "application/zip": "doc",
    "video/mp4": "video",
    "audio/mpeg": "audio",
}
