"""
Python mirror of `web/src/lib/crypto.ts` — AES-256-GCM token encryption.

Why this exists: Page access tokens and the long-lived user token are encrypted
at-rest in Postgres by the web app's OAuth callback. The Python agent (Flow B)
needs to decrypt those tokens to publish organic content via Graph. Both
sides must agree on the wire format byte-for-byte; this module is the
agent-side decoder.

Storage format (base64url):
    [1 byte key_version][12 bytes IV][N bytes ciphertext][16 bytes tag]

Key sourcing matches the web app:
  - `META_ENCRYPTION_KEY_BASE64` (or `..._V<n>` per version) — current key.
  - `META_ENCRYPTION_KEY_BASE64_V<n>` — older versions retained for
    decryption of legacy ciphertext.

Encryption is intentionally not exposed here. The agent reads tokens; the web
side is the only writer. If a future agent flow needs to write encrypted
tokens (e.g. system-user-token rotation from a CLI), add `encrypt_token()`
with the same wire format and document why.
"""

from __future__ import annotations

import base64
import os
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_IV_BYTES = 12
_TAG_BYTES = 16
_KEY_BYTES = 32


class CryptoError(RuntimeError):
    """Raised on key-load or decrypt failures. Don't catch generically — these
    are config/data-integrity failures that must surface."""


@lru_cache(maxsize=1)
def _load_key_versions() -> dict[int, bytes]:
    """Load every known key version from env, keyed by version byte (1..255)."""
    out: dict[int, bytes] = {}

    # Heuristic: the web app calls the current key v1 unless rotation has
    # happened. To stay forward-compatible we scan v1..v9.
    primary = os.environ.get("META_ENCRYPTION_KEY_BASE64")
    if primary:
        out[_load_v(primary, 1)[0]] = _load_v(primary, 1)[1]
    for v in range(1, 10):
        envar = f"META_ENCRYPTION_KEY_BASE64_V{v}"
        raw = os.environ.get(envar)
        if raw:
            out[v] = _decode_key(raw, envar)
    if not out:
        raise CryptoError(
            "no encryption keys loaded — set META_ENCRYPTION_KEY_BASE64 "
            "(or _V1..) so the agent can decrypt page tokens"
        )
    return out


def _load_v(raw: str, default_version: int) -> tuple[int, bytes]:
    return default_version, _decode_key(raw, "META_ENCRYPTION_KEY_BASE64")


def _decode_key(raw: str, name: str) -> bytes:
    try:
        key = base64.b64decode(raw)
    except Exception as e:
        raise CryptoError(f"{name} is not valid base64: {e}") from e
    if len(key) != _KEY_BYTES:
        raise CryptoError(f"{name} must decode to {_KEY_BYTES} bytes; got {len(key)}")
    return key


def _b64url_decode(s: str) -> bytes:
    # web's base64url has no padding; Python wants it.
    pad = "=" * ((4 - len(s) % 4) % 4)
    return base64.urlsafe_b64decode(s + pad)


def decrypt_token(packed: str) -> str:
    """
    Decrypt a token encrypted by the web app's `encryptToken`. Returns the
    plaintext UTF-8 string. Throws `CryptoError` on bad input / wrong key /
    tampered ciphertext.

    Format reminder:
        buf[0]              = key_version (1..n)
        buf[1:13]           = 12-byte IV
        buf[13:-16]         = ciphertext
        buf[-16:]           = 16-byte auth tag (AES-GCM)
    """
    if not isinstance(packed, str) or not packed:
        raise CryptoError("decrypt_token: input must be a non-empty string")
    buf = _b64url_decode(packed)
    if len(buf) < 1 + _IV_BYTES + _TAG_BYTES:
        raise CryptoError("decrypt_token: input too short")
    version = buf[0]
    iv = buf[1 : 1 + _IV_BYTES]
    tag = buf[-_TAG_BYTES:]
    ct = buf[1 + _IV_BYTES : -_TAG_BYTES]

    keys = _load_key_versions()
    key = keys.get(version)
    if key is None:
        raise CryptoError(
            f"decrypt_token: unknown key_version={version} — set "
            f"META_ENCRYPTION_KEY_BASE64_V{version}"
        )

    # AESGCM in `cryptography` wants ciphertext || tag combined.
    aes = AESGCM(key)
    try:
        plaintext = aes.decrypt(iv, ct + tag, associated_data=None)
    except Exception as e:
        raise CryptoError(
            f"decrypt_token: authentication failed (tampered or wrong key): {e}"
        ) from e
    return plaintext.decode("utf-8")
