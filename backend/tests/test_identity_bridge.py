from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from ordivant import identity
from ordivant.api import app as work_app
from ordivant.db import Base, make_engine
from ordivant.identity import IdentityBinding
from ordivant.models import Agent, Organization, Principal, ProjectMembership


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


def test_identity_cookie_scopes_mutations_and_bearer_precedence(api_client, system, monkeypatch, tmp_path):
    user = {
        "id": "identity-user-1",
        "name": "Cookie Manager",
        "role": "member",
        "active": True,
        "permissions": {
            "work": {"role": "manager", "scope_ids": [system["ids"]["project"]]},
        },
    }
    calls = configure_identity(monkeypatch, tmp_path, user)
    api_client.cookies.set("suite_session", "opaque-session")
    with system["factory"]() as session:
        agent_memberships_before = set(
            session.execute(
                select(ProjectMembership.project_id, ProjectMembership.principal_id)
                .join(Principal, Principal.id == ProjectMembership.principal_id)
                .where(Principal.kind == "agent")
            ).all()
        )
        agent_ids_before = set(session.scalars(select(Agent.id)))

    projects = api_client.get("/api/projects")
    assert projects.status_code == 200
    assert [project["id"] for project in projects.json()] == [system["ids"]["project"]]
    assert calls == [("http://identity.test", "test-service-token", "opaque-session")]

    payload = {"project_id": system["ids"]["project"], "title": "Cookie task"}
    forged_origin = api_client.post("/api/tasks", json=payload, headers={"Origin": "https://evil.example", "X-CSRF-Token": "csrf-value"})
    assert forged_origin.status_code == 403
    bad_csrf = api_client.post("/api/tasks", json=payload, headers={"Origin": "https://suite.example", "X-CSRF-Token": "wrong"})
    assert bad_csrf.status_code == 403
    accepted = api_client.post(
        "/api/tasks",
        json=payload,
        headers={"Origin": "https://suite.example", "X-CSRF-Token": "csrf-value"},
    )
    assert accepted.status_code == 201, accepted.text

    calls_before_bearer = len(calls)
    invalid_bearer = api_client.get("/api/projects", headers={"Authorization": "Bearer invalid", "Origin": "https://suite.example"})
    assert invalid_bearer.status_code == 401
    assert len(calls) == calls_before_bearer

    user["permissions"]["work"]["scope_ids"] = []
    removed = api_client.get("/api/projects")
    assert removed.status_code == 200
    assert removed.json() == []
    with system["factory"]() as session:
        binding = session.get(IdentityBinding, "identity-user-1")
        principal = session.get(Principal, binding.principal_id)
        assert principal.role == "manager"
        assert session.scalars(select(ProjectMembership.project_id).where(ProjectMembership.principal_id == principal.id)).all() == []

    user["permissions"]["work"]["scope_ids"] = [system["ids"]["project"]]
    denied_scope_creation = api_client.post(
        "/api/projects",
        json={"key": "member-project", "name": "Member Project"},
        headers={"Origin": "https://suite.example", "X-CSRF-Token": "csrf-value"},
    )
    assert denied_scope_creation.status_code == 403
    assert denied_scope_creation.json()["detail"]["code"] == "identity_admin_required"

    user["role"] = "admin"
    user["permissions"] = {}
    administrator = api_client.get("/api/projects")
    assert administrator.status_code == 200
    assert {project["id"] for project in administrator.json()} == {
        system["ids"]["project"], system["ids"]["isolated_project"]
    }
    created_project = api_client.post(
        "/api/projects",
        json={"key": "identity-admin", "name": "Identity Admin Project"},
        headers={"Origin": "https://suite.example", "X-CSRF-Token": "csrf-value"},
    )
    assert created_project.status_code == 201, created_project.text
    with system["factory"]() as session:
        binding = session.get(IdentityBinding, "identity-user-1")
        assert binding.identity_admin is True
        assert set(
            session.execute(
                select(ProjectMembership.project_id, ProjectMembership.principal_id)
                .join(Principal, Principal.id == ProjectMembership.principal_id)
                .where(Principal.kind == "agent")
            ).all()
        ) == agent_memberships_before
        assert set(session.scalars(select(Agent.id))) == agent_ids_before

    local_session = api_client.post("/api/auth/local-session")
    assert local_session.status_code == 403


def test_identity_outage_fails_closed(api_client, system, monkeypatch, tmp_path):
    user = {
        "id": "identity-user-outage",
        "name": "Unavailable User",
        "role": "member",
        "active": True,
        "permissions": {"work": {"role": "worker", "scope_ids": [system["ids"]["project"]]}},
    }
    configure_identity(monkeypatch, tmp_path, user, outage=True)
    api_client.cookies.set("suite_session", "opaque-session")

    response = api_client.get("/api/projects")

    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "identity_unavailable"


def test_concurrent_first_cookie_requests_create_one_binding(api_client, system, monkeypatch, tmp_path):
    user = {
        "id": "identity-user-race",
        "name": "Concurrent User",
        "role": "member",
        "active": True,
        "permissions": {"work": {"role": "worker", "scope_ids": [system["ids"]["project"]]}},
    }
    configure_identity(monkeypatch, tmp_path, user)

    def request_me(_index):
        client = TestClient(api_client.app, client=("127.0.0.1", 50890 + _index))
        client.cookies.set("suite_session", "opaque-session")
        try:
            return client.get("/api/me")
        finally:
            client.close()

    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(request_me, range(4)))

    assert [response.status_code for response in responses] == [200] * 4
    assert len({response.json()["id"] for response in responses}) == 1
    with system["factory"]() as session:
        assert session.get(IdentityBinding, "identity-user-race") is not None


def test_organization_selection_does_not_follow_identity_scopes(system, monkeypatch, tmp_path):
    user = {
        "id": "identity-user-org-choice",
        "name": "Organization User",
        "role": "member",
        "active": True,
        "permissions": {"work": {"role": "worker", "scope_ids": [system["ids"]["project"]]}},
    }
    configure_identity(monkeypatch, tmp_path, user)
    second_org_id = "00000000-0000-0000-0000-000000000002"
    with system["factory"]() as session:
        session.add(Organization(id=second_org_id, name="Second Org", created_at=identity.now_utc()))
        session.commit()

    client = TestClient(work_app, client=("127.0.0.1", 50901))
    client.cookies.set("suite_session", "opaque-session")
    ambiguous = client.get("/api/me")
    assert ambiguous.status_code == 403
    assert ambiguous.json()["detail"]["code"] == "identity_organization_required"

    monkeypatch.setenv("ORDIVANT_IDENTITY_ORG_ID", second_org_id)
    cross_org = client.get("/api/me")
    assert cross_org.status_code == 403
    assert cross_org.json()["detail"]["code"] == "identity_cross_organization_scope"

    monkeypatch.setenv("ORDIVANT_IDENTITY_ORG_ID", system["ids"]["organization"])
    selected = client.get("/api/me")
    assert selected.status_code == 200
    assert selected.json()["organization_id"] == system["ids"]["organization"]


def test_empty_database_uses_deterministic_identity_organization(tmp_path, monkeypatch):
    monkeypatch.delenv("ORDIVANT_IDENTITY_ORG_ID", raising=False)
    engine = make_engine(f"sqlite:///{(tmp_path / 'empty-work.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    user = {
        "id": "identity-user-empty-db",
        "name": "Empty Database User",
        "role": "member",
        "active": True,
        "permissions": {"work": {"role": "worker", "scope_ids": []}},
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
