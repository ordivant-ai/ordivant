from __future__ import annotations

import hashlib
import hmac
import secrets

from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError


PASSWORD_HASHER = PasswordHasher(type=Type.ID, time_cost=2, memory_cost=19456, parallelism=1)
DUMMY_PASSWORD_HASH = PASSWORD_HASHER.hash(secrets.token_urlsafe(32))


def hash_password(password: str) -> str:
    return PASSWORD_HASHER.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return PASSWORD_HASHER.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def new_secret() -> str:
    return secrets.token_urlsafe(32)


def session_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def keyed_hash(secret: str, purpose: str, raw: str) -> str:
    message = f"{purpose}:{raw}".encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def csrf_token(secret: str, raw_session: str) -> str:
    return hmac.new(secret.encode("utf-8"), raw_session.encode("utf-8"), hashlib.sha256).hexdigest()


def constant_time_equal(expected: str, supplied: str | None) -> bool:
    return bool(supplied) and hmac.compare_digest(expected.encode("utf-8"), supplied.encode("utf-8"))
