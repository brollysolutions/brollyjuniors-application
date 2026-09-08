"""
Password hashing.

The stored format is byte-for-byte the one the previous Node build wrote:

    scrypt$<N>$<r>$<p>$<salt base64>$<key base64>

That is deliberate. It means every account seeded or created before this
rewrite still signs in, and a future migration to Argon2id remains the small
versioned change it always was.

scrypt is memory-hard and ships in the standard library, so the app installs
and runs with no native build step.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import unicodedata

N, R, P, KEYLEN = 16384, 8, 1, 32
MAXMEM = 64 * 1024 * 1024


def _derive(plain: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    return hashlib.scrypt(
        unicodedata.normalize("NFKC", plain).encode("utf-8"),
        salt=salt, n=n, r=r, p=p, dklen=dklen, maxmem=MAXMEM,
    )


def hash_password(plain: str) -> str:
    salt = secrets.token_bytes(16)
    key = _derive(plain, salt, N, R, P, KEYLEN)
    return "$".join([
        "scrypt", str(N), str(R), str(P),
        base64.b64encode(salt).decode(), base64.b64encode(key).decode(),
    ])


def verify_password(plain: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt_b64, key_b64 = stored.split("$")
        if scheme != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(key_b64)
        actual = _derive(plain, salt, int(n), int(r), int(p), len(expected))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def temp_password(length: int = 8) -> str:
    """Readable one-time password for a new teacher account. No 0/O/1/l."""
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))
