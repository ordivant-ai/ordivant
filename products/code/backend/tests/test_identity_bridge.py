from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from ordivant_code import identity
from ordivant_code.db import Base, SessionLocal, make_engine
from ordivant_code.identity import IdentityBinding
from ordivant_code.models import Organization, Principal, Project, Scope, ScopeMembership


def configure_identity(monkeypatch, tmp_path, user, *, outage=False):
    monkeypatch.delenv("ORDIVANT_IDENTITY_ORG_ID", raising=False)
    token_file = tmp_path / "identity-service-token"
    token_file.write_text("test-service-token", encoding="utf-8")
    monkeypatch.setenv("ORDIVANT_AUTH_COOKIE_NAME", "suite_session")
    monkeypatch.setenv("ORDIVANT_AUTH_ORIGINS", "https://suite.example")
    monkeypatch.setenv("ORDIVANT_IDENTITY_URL", "http://identity.test")
    monkeypatch.setenv("ORDIVANT_IDENTITY_SERVICE_TOKEN_FILE", str(token_file))
    calls = []

    async def fake_introspect(identity_url, service_token, session_token):
        calls.append((identity_url, service_token, session_token))
        if outage:
            raise identity._unavailable()
        return user, "csrf-value"

    monkeypatch.setattr(identity, "_introspect", fake_introspect)
    return calls


def primary_project_id(organization_id: str) -> str:
    with SessionLocal() as session:
        return session.scalar(
            select(Project.id).where(Project.organization_id == organization_id, Project.key == "code-demo")
        )


def test_identity_cookie_scopes_code_and_revokes_removed_access(api, credentials, monkeypatch, tmp_path):
    project_id = primary_project_id(credentials["organization_id"])
    user = {
        "id": "identity-code-user",
        "name": "Code Reader",
        "role": "member",
        "active": True,
        "permissions": {
            "code": {"role": "reader", "scope_ids": [project_id]},
        },
    }
    calls = configure_identity(monkeypatch, tmp_path, user)
    api.cookies.set("suite_session", "opaque-session")

    response = api.get("/api/projects")
    assert response.status_code == 200
    assert [project["key"] for project in response.json()] == ["code-demo"]
    assert calls == [("http://identity.test", "test-service-token", "opaque-session")]

    payload = {"key": "cookie-project", "name": "Cookie Project"}
    forged = api.post(
        "/api/projects",
        json=payload,
        headers={"Origin": "https://evil.example", "X-CSRF-Token": "csrf-value"},
    )
    assert forged.status_code == 403
    assert forged.json()["detail"]["code"] == "origin_not_allowed"
    csrf = api.post(
        "/api/projects",
        json=payload,
        headers={"Origin": "https://suite.example", "X-CSRF-Token": "wrong"},
    )
    assert csrf.status_code == 403
    assert csrf.json()["detail"]["code"] == "csrf_failed"

    calls_before_bearer = len(calls)
    invalid_bearer = api.get("/api/projects", headers={"Authorization": "Bearer invalid"})
    assert invalid_bearer.status_code == 401
    assert len(calls) == calls_before_bearer

    user["permissions"]["code"]["scope_ids"] = []
    removed = api.get("/api/projects")
    assert removed.status_code == 200
    assert removed.json() == []
    with SessionLocal() as session:
        binding = session.get(IdentityBinding, "identity-code-user")
        principal = session.get(Principal, binding.principal_id)
        assert principal.role == "reader"
        assert session.scalars(
            select(ScopeMembership.scope_id).where(ScopeMembership.principal_id == principal.id)
        ).all() == []

    user["permissions"]["code"] = {"role": "manager", "scope_ids": [project_id]}
    denied_project = api.post(
        "/api/projects",
        json={"key": "member-project", "name": "Member Project"},
        headers={"Origin": "https://suite.example", "X-CSRF-Token": "csrf-value"},
    )
    assert denied_project.status_code == 403
    assert denied_project.json()["detail"]["code"] == "identity_admin_required"

    user["role"] = "admin"
    user["permissions"] = {}
    with SessionLocal() as session:
        expected_projects = set(session.scalars(select(Project.key).where(Project.organization_id == credentials["organization_id"])))
    administrator = api.get("/api/projects")
    assert administrator.status_code == 200
    assert {project["key"] for project in administrator.json()} == expected_projects
    created_project = api.post(
        "/api/projects",
        json={"key": "identity-admin", "name": "Identity Admin Project"},
        headers={
            "Origin": "https://suite.example",
            "X-CSRF-Token": "csrf-value",
            "Idempotency-Key": "identity-admin-project",
        },
    )
    assert created_project.status_code == 200, created_project.text
    with SessionLocal() as session:
        binding = session.get(IdentityBinding, "identity-code-user")
        principal = session.get(Principal, binding.principal_id)
        expected_scopes = set(session.scalars(select(Scope.id).where(Scope.organization_id == credentials["organization_id"])))
        assert binding.identity_admin is True
        assert principal.role == "manager"
        assert set(
            session.scalars(select(ScopeMembership.scope_id).where(ScopeMembership.principal_id == principal.id))
        ) == expected_scopes

    local_session = api.post("/api/auth/local-session", json={})
    assert local_session.status_code == 403


def test_identity_outage_fails_closed(api, credentials, monkeypatch, tmp_path):
    user = {
        "id": "identity-code-outage",
        "name": "Unavailable User",
        "role": "member",
        "active": True,
        "permissions": {"code": {"role": "reader", "scope_ids": [primary_project_id(credentials["organization_id"])]}},
    }
    configure_identity(monkeypatch, tmp_path, user, outage=True)
    api.cookies.set("suite_session", "opaque-session")

    response = api.get("/api/projects")

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "identity_unavailable"


def test_concurrent_first_cookie_requests_create_one_binding(api, credentials, monkeypatch, tmp_path):
    user = {
        "id": "identity-code-race",
        "name": "Concurrent User",
        "role": "member",
        "active": True,
        "permissions": {"code": {"role": "reader", "scope_ids": [primary_project_id(credentials["organization_id"])]}},
    }
    configure_identity(monkeypatch, tmp_path, user)

    def request_me(_index):
        client = TestClient(api.app, client=("127.0.0.1", 52100 + _index))
        client.cookies.set("suite_session", "opaque-session")
        try:
            return client.get("/api/me")
        finally:
            client.close()

    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(request_me, range(4)))

    assert [response.status_code for response in responses] == [200] * 4
    assert len({response.json()["id"] for response in responses}) == 1
    with SessionLocal() as session:
        assert session.get(IdentityBinding, "identity-code-race") is not None


def test_organization_selection_does_not_follow_identity_scopes(api, credentials, monkeypatch, tmp_path):
    user = {
        "id": "identity-code-org-choice",
        "name": "Organization User",
        "role": "member",
        "active": True,
        "permissions": {"code": {"role": "reader", "scope_ids": [primary_project_id(credentials["organization_id"])]}},
    }
    configure_identity(monkeypatch, tmp_path, user)
    second_org_id = "00000000-0000-0000-0000-000000000002"
    with SessionLocal() as session:
        session.add(Organization(id=second_org_id, name="Second Org", created_at=identity.now_utc()))
        session.commit()

    client = TestClient(api.app, client=("127.0.0.1", 52110))
    client.cookies.set("suite_session", "opaque-session")
    ambiguous = client.get("/api/me")
    assert ambiguous.status_code == 403
    assert ambiguous.json()["detail"]["code"] == "identity_organization_required"

    monkeypatch.setenv("ORDIVANT_IDENTITY_ORG_ID", second_org_id)
    cross_org = client.get("/api/me")
    assert cross_org.status_code == 403
    assert cross_org.json()["detail"]["code"] == "identity_cross_organization_scope"

    monkeypatch.setenv("ORDIVANT_IDENTITY_ORG_ID", credentials["organization_id"])
    selected = client.get("/api/me")
    assert selected.status_code == 200
    assert selected.json()["organization_id"] == credentials["organization_id"]


def test_empty_database_uses_deterministic_identity_organization(tmp_path, monkeypatch):
    monkeypatch.delenv("ORDIVANT_IDENTITY_ORG_ID", raising=False)
    engine = make_engine(f"sqlite:///{(tmp_path / 'empty-code.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    user = {
        "id": "identity-code-empty-db",
        "name": "Empty Database User",
        "role": "member",
        "active": True,
        "permissions": {"code": {"role": "reader", "scope_ids": []}},
    }
    try:
        with factory() as session:
            first = identity._sync_principal(session, user)
            principal_id = first.id
            organization_id = first.organization_id
        with factory() as session:
            second = identity._sync_principal(session, user)
            assert second.id == principal_id
            assert second.organization_id == organization_id == identity._EMPTY_DATABASE_ORGANIZATION_ID
            assert len(list(session.scalars(select(Organization.id)))) == 1
    finally:
        engine.dispose()
