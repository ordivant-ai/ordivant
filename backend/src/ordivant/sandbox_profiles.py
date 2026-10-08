from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import not_found
from .model_settings import require_model_admin
from .models import AuditEvent, SandboxProfile
from .security import new_id, now_utc, principal_projects


DEFAULT_LIMITS = {
    "timeout_seconds": 120,
    "memory_mb": 512,
    "cpu_count": 1.0,
    "pids_limit": 64,
    "output_bytes": 16384,
    "workspace_mb": 32,
}


def _loads(value: str) -> dict:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return dict(DEFAULT_LIMITS)


def sandbox_profile_json(row: SandboxProfile) -> dict:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "name": row.name,
        "enabled": row.enabled,
        "limits": _loads(row.limits_json),
        "created_at": row.created_at.isoformat().replace("+00:00", "Z"),
        "updated_at": row.updated_at.isoformat().replace("+00:00", "Z"),
    }


def list_sandbox_profiles(session: Session, actor, project_id: str | None = None) -> list[dict]:
    project_ids = principal_projects(session, actor.id)
    if project_id:
        from .service import require_project

        require_project(session, actor, project_id)
        project_ids = [project_id]
    if not project_ids:
        return []
    rows = session.scalars(
        select(SandboxProfile)
        .where(SandboxProfile.project_id.in_(project_ids))
        .order_by(SandboxProfile.project_id, SandboxProfile.name, SandboxProfile.id)
    )
    return [sandbox_profile_json(row) for row in rows]


def get_sandbox_profile(session: Session, actor, profile_id: str) -> SandboxProfile:
    row = session.get(SandboxProfile, profile_id)
    if row is None:
        raise not_found("找不到 Sandbox profile")
    from .service import require_project

    require_project(session, actor, row.project_id)
    return row


def create_sandbox_profile(session: Session, actor, value: dict) -> dict:
    require_model_admin(session, actor)
    from .service import require_project

    require_project(session, actor, value["project_id"])
    limits = {**DEFAULT_LIMITS, **value["limits"]}
    row = SandboxProfile(
        id=new_id(), project_id=value["project_id"], name=value["name"], enabled=value["enabled"],
        limits_json=json.dumps(limits, separators=(",", ":")), created_at=now_utc(), updated_at=now_utc(),
    )
    session.add(row)
    session.add(
        AuditEvent(
            id=new_id(), project_id=row.project_id, actor_id=actor.id, action="sandbox_profile.created",
            entity_type="sandbox_profile", entity_id=row.id,
            data_json=json.dumps({"enabled": row.enabled, "limits": limits}, separators=(",", ":")),
            created_at=now_utc(),
        )
    )
    session.flush()
    return sandbox_profile_json(row)


def patch_sandbox_profile(session: Session, actor, profile_id: str, patch: dict) -> dict:
    require_model_admin(session, actor)
    row = get_sandbox_profile(session, actor, profile_id)
    fields = []
    if patch.get("name") is not None:
        row.name = patch["name"]
        fields.append("name")
    if patch.get("enabled") is not None:
        row.enabled = patch["enabled"]
        fields.append("enabled")
    if patch.get("limits") is not None:
        row.limits_json = json.dumps(patch["limits"], separators=(",", ":"))
        fields.append("limits")
    row.updated_at = now_utc()
    session.add(
        AuditEvent(
            id=new_id(), project_id=row.project_id, actor_id=actor.id, action="sandbox_profile.updated",
            entity_type="sandbox_profile", entity_id=row.id,
            data_json=json.dumps({"fields": fields}, separators=(",", ":")), created_at=now_utc(),
        )
    )
    session.flush()
    return sandbox_profile_json(row)


def sandbox_snapshot(session: Session, profile_id: str, project_id: str) -> dict:
    row = session.get(SandboxProfile, profile_id)
    if row is None or row.project_id != project_id or not row.enabled:
        raise not_found("找不到 enabled Sandbox profile")
    return {
        "id": row.id,
        "project_id": row.project_id,
        "name": row.name,
        "limits": _loads(row.limits_json),
    }
