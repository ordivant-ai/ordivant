from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from ordivant_knowledge import identity
from ordivant_knowledge.db import Base, make_engine
from ordivant_knowledge.identity import IdentityBinding
from ordivant_knowledge.models import Organization, Principal, SpaceMembership


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


def test_identity_cookie_syncs_exact_spaces_and_revokes_removed_access(system, monkeypatch, tmp_path):
    app = system["app"]
    user = {
        "id": "identity-knowledge-user",
        "name": "Knowledge Reader",
        "role": "member",
        "active": True,
        "permissions": {
            "knowledge": {"role": "reader", "scope_ids": [system["bootstrap"]["primary_scope_id"]]},
        },
    }
    calls = configure_identity(monkeypatch, tmp_path, user)
    client = TestClient(app, client=("127.0.0.1", 50881))
    client.cookies.set("suite_session", "opaque-session")

    response = client.get("/api/spaces")
    assert response.status_code == 200
    assert [space["id"] for space in response.json()] == [system["bootstrap"]["primary_scope_id"]]
    assert calls == [("http://identity.test", "test-service-token", "opaque-session")]

    document = {
        "space_id": system["bootstrap"]["primary_scope_id"],
        "title": "Denied document",
        "body": "content",
    }
    forged = client.post(
        "/api/documents",
        json=document,
        headers={"Origin": "https://evil.example", "X-CSRF-Token": "csrf-value"},
    )
    assert forged.status_code == 403
    csrf = client.post(
        "/api/documents",
        json=document,
        headers={"Origin": "https://suite.example", "X-CSRF-Token": "wrong"},
    )
    assert csrf.status_code == 403

    calls_before_bearer = len(calls)
    invalid_bearer = client.get("/api/spaces", headers={"Authorization": "Bearer invalid"})
    assert invalid_bearer.status_code == 401
    assert len(calls) == calls_before_bearer

    user["permissions"]["knowledge"]["scope_ids"] = []
    removed = client.get("/api/spaces")
    assert removed.status_code == 200
    assert removed.json() == []
    with system["app"].state.session_factory() as session:
        binding = session.get(IdentityBinding, "identity-knowledge-user")
        principal = session.get(Principal, binding.principal_id)
        assert principal.role == "reader"
        assert session.scalars(
            select(SpaceMembership.space_id).where(SpaceMembership.principal_id == principal.id)
        ).all() == []

    user["permissions"]["knowledge"] = {
        "role": "manager",
        "scope_ids": [system["bootstrap"]["primary_scope_id"]],
    }
    denied_space = client.post(
        "/api/spaces",
        json={"key": "member-space", "name": "Member Space"},
        headers={"Origin": "https://suite.example", "X-CSRF-Token": "csrf-value"},
    )
    assert denied_space.status_code == 403
    assert denied_space.json()["detail"]["code"] == "identity_admin_required"

    user["role"] = "admin"
    user["permissions"] = {}
    administrator = client.get("/api/spaces")
    assert administrator.status_code == 200
    assert {space["id"] for space in administrator.json()} == {
        system["bootstrap"]["primary_scope_id"], system["bootstrap"]["isolated_scope_id"]
    }
    created_space = client.post(
        "/api/spaces",
        json={"key": "identity-admin", "name": "Identity Admin Space"},
        headers={"Origin": "https://suite.example", "X-CSRF-Token": "csrf-value"},
    )
    assert created_space.status_code == 201, created_space.text
    with system["app"].state.session_factory() as session:
        binding = session.get(IdentityBinding, "identity-knowledge-user")
        principal = session.get(Principal, binding.principal_id)
        assert binding.identity_admin is True
        assert principal.role == "manager"

    local_session = client.post("/api/auth/local-session", json={})
    assert local_session.status_code == 403


def test_identity_outage_and_missing_product_permission_fail_closed(system, monkeypatch, tmp_path):
    app = system["app"]
    user = {
        "id": "identity-knowledge-outage",
        "name": "Unavailable User",
        "role": "member",
        "active": True,
        "permissions": {"knowledge": {"role": "reader", "scope_ids": []}},
    }
    configure_identity(monkeypatch, tmp_path, user, outage=True)
    client = TestClient(app, client=("127.0.0.1", 50882))
    client.cookies.set("suite_session", "opaque-session")
    outage = client.get("/api/spaces")
    assert outage.status_code == 503
    assert outage.json()["detail"]["code"] == "identity_unavailable"

    user["permissions"] = {}
    configure_identity(monkeypatch, tmp_path, user)
    denied = client.get("/api/spaces")
    assert denied.status_code == 403
    assert denied.json()["detail"]["code"] == "product_access_denied"


def test_concurrent_first_cookie_requests_create_one_binding(system, monkeypatch, tmp_path):
    app = system["app"]
    user = {
        "id": "identity-knowledge-race",
        "name": "Concurrent User",
        "role": "member",
        "active": True,
        "permissions": {
            "knowledge": {"role": "reader", "scope_ids": [system["bootstrap"]["primary_scope_id"]]},
        },
    }
    configure_identity(monkeypatch, tmp_path, user)

    def request_me(_index):
        client = TestClient(app, client=("127.0.0.1", 50890 + _index))
        client.cookies.set("suite_session", "opaque-session")
        try:
            return client.get("/api/me")
        finally:
            client.close()

    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(request_me, range(4)))

    assert [response.status_code for response in responses] == [200] * 4
    assert len({response.json()["id"] for response in responses}) == 1
    with app.state.session_factory() as session:
        assert session.get(IdentityBinding, "identity-knowledge-race") is not None


def test_organization_selection_does_not_follow_identity_scopes(system, monkeypatch, tmp_path):
    app = system["app"]
    user = {
        "id": "identity-knowledge-org-choice",
        "name": "Organization User",
        "role": "member",
        "active": True,
        "permissions": {
            "knowledge": {"role": "reader", "scope_ids": [system["bootstrap"]["primary_scope_id"]]},
        },
    }
    configure_identity(monkeypatch, tmp_path, user)
    second_org_id = "knowledge-second-organization"
    with app.state.session_factory() as session:
        session.add(Organization(id=second_org_id, name="Second Org", created_at=identity.now_iso()))
        session.commit()

    client = TestClient(app, client=("127.0.0.1", 50883))
    client.cookies.set("suite_session", "opaque-session")
    ambiguous = client.get("/api/me")
    assert ambiguous.status_code == 403
    assert ambiguous.json()["detail"]["code"] == "identity_organization_required"

    monkeypatch.setenv("ORDIVANT_IDENTITY_ORG_ID", second_org_id)
    cross_org = client.get("/api/me")
    assert cross_org.status_code == 403
    assert cross_org.json()["detail"]["code"] == "identity_cross_organization_scope"

    monkeypatch.setenv("ORDIVANT_IDENTITY_ORG_ID", system["bootstrap"]["organization_id"])
    selected = client.get("/api/me")
    assert selected.status_code == 200
    assert selected.json()["organization_id"] == system["bootstrap"]["organization_id"]


def test_empty_database_uses_deterministic_identity_organization(tmp_path, monkeypatch):
    monkeypatch.delenv("ORDIVANT_IDENTITY_ORG_ID", raising=False)
    engine = make_engine(f"sqlite:///{(tmp_path / 'empty-knowledge.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
    user = {
        "id": "identity-knowledge-empty-db",
        "name": "Empty Database User",
        "role": "member",
        "active": True,
        "permissions": {"knowledge": {"role": "reader", "scope_ids": []}},
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
