from __future__ import annotations

import json

from sqlalchemy import select

from . import models  # noqa: F401
from .config import data_dir
from .db import Base, SessionLocal, engine
from .models import Organization, Principal, Project, Scope, ScopeMembership
from .security import issue_token, new_id, now_utc, token_hash


def run_seed() -> dict:
    Base.metadata.create_all(engine)
    folder = data_dir()
    folder.mkdir(parents=True, exist_ok=True)
    bootstrap_path = folder / "bootstrap.json"
    existing = {}
    if bootstrap_path.exists():
        try:
            existing = json.loads(bootstrap_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = {}

    session = SessionLocal()
    try:
        organization = session.scalar(select(Organization).where(Organization.name == "Ordivant Code DEMO"))
        if organization is None:
            organization = Organization(id=new_id(), name="Ordivant Code DEMO", created_at=now_utc())
            session.add(organization)
            session.flush()

        def ensure_project(key: str, name: str, description: str) -> Project:
            project = session.scalar(select(Project).where(Project.organization_id == organization.id, Project.key == key))
            if project:
                return project
            scope = Scope(id=new_id(), organization_id=organization.id, name=name, created_at=now_utc())
            session.add(scope)
            session.flush()
            project = Project(
                id=new_id(), scope_id=scope.id, key=key, name=name,
                description=description, organization_id=organization.id, created_at=now_utc(),
            )
            session.add(project)
            session.flush()
            return project

        primary = ensure_project(
            "code-demo", "DEMO Code Repository Pilot",
            "DEMO seed project for validating private Gitea repositories, branches, pull requests, and status receipts.",
        )
        isolated = ensure_project(
            "code-isolated-demo", "DEMO Isolated Project",
            "DEMO-only scope used to verify project isolation.",
        )
        principals: dict[str, Principal] = {}
        for name, role in (("manager", "manager"), ("writer", "writer"), ("reader", "reader")):
            principal = session.scalar(select(Principal).where(
                Principal.organization_id == organization.id,
                Principal.name == f"code-demo-{name}",
            ))
            if principal is None:
                principal = Principal(
                    id=new_id(), organization_id=organization.id, name=f"code-demo-{name}",
                    kind="human" if name == "manager" else "agent", role=role,
                    active=True, created_at=now_utc(),
                )
                session.add(principal)
                session.flush()
            principals[name] = principal

        for role_name, principal in principals.items():
            allowed_projects = [primary, isolated] if role_name == "manager" else [primary]
            for project in allowed_projects:
                present = session.scalar(select(ScopeMembership.id).where(
                    ScopeMembership.principal_id == principal.id,
                    ScopeMembership.scope_id == project.scope_id,
                ))
                if present is None:
                    membership_role = "manager" if role_name == "manager" else role_name
                    session.add(ScopeMembership(
                        id=new_id(), principal_id=principal.id,
                        scope_id=project.scope_id, role=membership_role,
                    ))

        session.flush()
        token_fields = {"manager": "manager_token", "writer": "writer_token", "reader": "reader_token"}
        tokens = {}
        for role_name, principal in principals.items():
            token = existing.get(token_fields[role_name])
            stored = session.scalar(select(models.AuthToken.id).where(
                models.AuthToken.principal_id == principal.id,
                models.AuthToken.token_hash == token_hash(token),
                models.AuthToken.revoked_at.is_(None),
            )) if token else None
            if not stored:
                token = issue_token(session, principal.id)
            tokens[role_name] = token

        session.commit()
        result = {
            "manager_token": tokens["manager"],
            "writer_token": tokens["writer"],
            "reader_token": tokens["reader"],
            "manager_id": principals["manager"].id,
            "writer_id": principals["writer"].id,
            "reader_id": principals["reader"].id,
            "organization_id": organization.id,
            "primary_scope_id": primary.scope_id,
            "isolated_scope_id": isolated.scope_id,
        }
        bootstrap_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        try:
            bootstrap_path.chmod(0o600)
        except OSError:
            pass
        return result
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def main():
    run_seed()
    print(f"Ordivant Code DEMO seed ready: {data_dir() / 'bootstrap.json'}")


if __name__ == "__main__":
    main()
