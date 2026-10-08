from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import DomainError
from .models import AuthToken, Principal, ProjectMembership


def new_id() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(UTC)


def new_secret(prefix: str = "ovt") -> str:
    return f"{prefix}_{secrets.token_urlsafe(36)}"


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def issue_token(session: Session, principal_id: str) -> str:
    token = new_secret()
    session.add(
        AuthToken(
            id=new_id(),
            principal_id=principal_id,
            token_hash=hash_secret(token),
            created_at=now_utc(),
        )
    )
    return token


def principal_for_token(session: Session, token: str) -> Principal | None:
    return session.scalar(
        select(Principal)
        .join(AuthToken, Principal.id == AuthToken.principal_id)
        .where(AuthToken.token_hash == hash_secret(token), AuthToken.revoked_at.is_(None), Principal.active.is_(True))
    )


def principal_projects(session: Session, principal_id: str) -> list[str]:
    return list(
        session.scalars(
            select(ProjectMembership.project_id)
            .where(ProjectMembership.principal_id == principal_id)
            .order_by(ProjectMembership.project_id)
        )
    )


def principal_json(session: Session, principal: Principal) -> dict:
    return {
        "id": principal.id,
        "name": principal.name,
        "kind": principal.kind,
        "role": principal.role,
        "organization_id": principal.organization_id,
        "project_ids": principal_projects(session, principal.id),
    }


def authenticate_header(session: Session, authorization: str | None) -> Principal:
    if not authorization or not authorization.startswith("Bearer "):
        raise DomainError(401, "unauthenticated", "需要 Bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise DomainError(401, "unauthenticated", "需要 Bearer token")
    principal = principal_for_token(session, token)
    if principal is None:
        raise DomainError(401, "unauthenticated", "token 無效或已撤銷")
    return principal
