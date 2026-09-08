"""
Access tokens are RS256 and short (10 minutes) so a verifier never holds a
signing key and a stolen token expires on its own. Refresh tokens are opaque,
stored only as a hash, rotated on every use, and a replayed one kills the whole
session family.
"""
from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from typing import Literal

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from ..config import settings

ALG = "RS256"
ISS = "brolly-juniors"
AUD = "brolly-b2c-api"

_private_pem: bytes | None = None
_public_pem: bytes | None = None


def _load_keys() -> tuple[bytes, bytes]:
    global _private_pem, _public_pem
    if _private_pem is not None and _public_pem is not None:
        return _private_pem, _public_pem

    key_dir = settings.key_dir
    priv_path = key_dir / "access.key"
    pub_path = key_dir / "access.pub"

    if priv_path.exists() and pub_path.exists():
        _private_pem = priv_path.read_bytes()
        _public_pem = pub_path.read_bytes()
        return _private_pem, _public_pem

    # First boot: mint a keypair and keep it, so restarting the API does not
    # sign every user out.
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pub = key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    key_dir.mkdir(parents=True, exist_ok=True)
    priv_path.write_bytes(priv)
    pub_path.write_bytes(pub)
    try:
        priv_path.chmod(0o600)
    except OSError:
        pass  # Windows ACLs; the directory is already user-scoped

    _private_pem, _public_pem = priv, pub
    return priv, pub


@dataclass(slots=True)
class AccessClaims:
    sub: str
    #: Primary role. There is no tenant claim, because there are no tenants.
    role: Literal["BROLLY_ADMIN", "TEACHER", "STUDENT"]
    sid: str
    pv: int


def sign_access_token(claims: AccessClaims) -> str:
    priv, _ = _load_keys()
    now = int(time.time())
    return jwt.encode(
        {
            "sub": claims.sub,
            "role": claims.role,
            "sid": claims.sid,
            "pv": claims.pv,
            "iss": ISS,
            "aud": AUD,
            "iat": now,
            "exp": now + settings.access_token_ttl_seconds,
        },
        priv,
        algorithm=ALG,
        headers={"kid": "access-1"},
    )


def verify_access_token(token: str) -> AccessClaims:
    _, pub = _load_keys()
    payload = jwt.decode(
        token, pub, algorithms=[ALG], issuer=ISS, audience=AUD,
    )
    return AccessClaims(
        sub=str(payload["sub"]),
        role=payload["role"],
        sid=str(payload["sid"]),
        pv=int(payload["pv"]),
    )


def new_refresh_token() -> str:
    return secrets.token_urlsafe(32)
