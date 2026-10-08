from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import DomainError
from .models import AuthToken, Principal, ScopeMembership


def new_id() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(UTC)


def new_token() -> str:
    return "ovc_" + secrets.token_urlsafe(36)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_token(session: Session, principal_id: str) -> str:
    token = new_token()
    session.add(AuthToken(id=new_id(), principal_id=principal_id, token_hash=token_hash(token), created_at=now_utc()))
    return token


def authenticate(session: Session, authorization: str | None) -> Principal:
    if not authorization or not authorization.startswith("Bearer "):
        raise DomainError(401, "unauthenticated", "Bearer token required")
    secret = authorization.removeprefix("Bearer ").strip()
    if not secret:
        raise DomainError(401, "unauthenticated", "Bearer token required")
    principal = session.scalar(
        select(Principal)
        .join(AuthToken, AuthToken.principal_id == Principal.id)
        .where(AuthToken.token_hash == token_hash(secret), AuthToken.revoked_at.is_(None), Principal.active.is_(True))
    )
    if principal is None:
        raise DomainError(401, "unauthenticated", "Token is invalid or revoked")
    return principal


def scope_ids(session: Session, principal_id: str) -> list[str]:
    return list(
        session.scalars(
            select(ScopeMembership.scope_id)
            .where(ScopeMembership.principal_id == principal_id)
            .order_by(ScopeMembership.scope_id)
        )
    )


def principal_json(session: Session, principal: Principal) -> dict:
    return {
        "id": principal.id,
        "name": principal.name,
        "kind": principal.kind,
        "role": principal.role,
        "organization_id": principal.organization_id,
        "scope_ids": scope_ids(session, principal.id),
    }
