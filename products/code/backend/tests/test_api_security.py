from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from conftest import auth
from ordivant_code.db import SessionLocal
from ordivant_code.models import Project, PullRequest, ScopeMembership
from ordivant_code.security import token_hash


def test_seed_roles_are_project_scoped(api, credentials):
    manager_headers = auth(credentials["manager_token"])
    writer_headers = auth(credentials["writer_token"])
    reader_headers = auth(credentials["reader_token"])
    manager_projects = api.get("/api/projects", headers=manager_headers)
    writer_projects = api.get("/api/projects", headers=writer_headers)
    reader_projects = api.get("/api/projects", headers=reader_headers)
    assert manager_projects.status_code == writer_projects.status_code == reader_projects.status_code == 200
    assert len(manager_projects.json()) == 2
    assert len(writer_projects.json()) == len(reader_projects.json()) == 1
    isolated = next(item for item in manager_projects.json() if item["key"] == "code-isolated-demo")
    assert api.get(f"/api/projects/{isolated['id']}", headers=writer_headers).status_code == 404
    assert api.get(f"/api/projects/{isolated['id']}", headers=reader_headers).status_code == 404


def test_reader_cannot_write_scoped_repository(api, credentials, repository):
    response = api.post(
        f"/api/repositories/{repository['id']}/branches",
        headers={**auth(credentials["reader_token"]), "Idempotency-Key": "reader-branch"},
        json={"name": "reader-attempt"},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "forbidden"


def test_idempotency_replay_rechecks_scope_and_payload(api, credentials):
    manager = auth(credentials["manager_token"])
    headers = {**manager, "Idempotency-Key": "project-create-replay"}
    body = {"key": "idempotency-check", "name": "Idempotency QA", "description": "isolated test"}
    first = api.post("/api/projects", headers=headers, json=body)
    replay = api.post("/api/projects", headers=headers, json=body)
    assert first.status_code == replay.status_code == 200
    assert first.json()["id"] == replay.json()["id"]
    changed = api.post("/api/projects", headers=headers, json={**body, "name": "Changed"})
    assert changed.status_code == 409

    with SessionLocal() as session:
        membership = session.scalar(select(ScopeMembership).where(
            ScopeMembership.principal_id == credentials["manager_id"],
            ScopeMembership.scope_id == session.scalar(select(Project.scope_id).where(Project.id == first.json()["id"])),
        ))
        assert membership is not None
        session.delete(membership)
        session.commit()
    denied_replay = api.post("/api/projects", headers=headers, json=body)
    assert denied_replay.status_code == 404


def test_offline_mode_serves_persisted_pull_metadata(api, credentials, repository):
    from ordivant_code.security import new_id, now_utc

    with SessionLocal() as session:
        pull = PullRequest(
            id=new_id(), repository_id=repository["id"], number=7, title="Saved PR", body="Persisted metadata",
            state="open", head="topic", base="main", web_url="http://127.0.0.1:3001/demo/7",
            head_sha="a" * 40, source_refs=[], created_at=now_utc(), updated_at=now_utc(),
        )
        session.add(pull)
        session.commit()
    response = api.get(f"/api/repositories/{repository['id']}/pulls", headers=auth(credentials["writer_token"]))
    assert response.status_code == 200
    assert any(item["number"] == 7 and item["body"] == "Persisted metadata" for item in response.json())
    context = api.get(f"/api/repositories/{repository['id']}/pulls/7", headers=auth(credentials["reader_token"]))
    assert context.status_code == 200
    assert context.json()["checks"] == []


def test_local_session_requires_development_and_reports_token_hash(api, monkeypatch):
    from ordivant_code.models import AuthToken

    local = api.post("/api/auth/local-session", json={})
    assert local.status_code == 200
    token = local.json()["token"]
    assert local.json()["principal"]["role"] == "manager"
    with SessionLocal() as session:
        stored = session.scalar(select(AuthToken.token_hash).where(AuthToken.principal_id == local.json()["principal"]["id"]))
        assert stored == token_hash(token)
        assert stored != token
    monkeypatch.setenv("ORDIVANT_MODE", "production")
    disabled = api.post("/api/auth/local-session", json={"name": "No Local Session"})
    assert disabled.status_code == 403


def test_dev_proxy_header_requires_matching_secret_and_never_overrides_production(api, monkeypatch, tmp_path):
    from ordivant_code.main import app as asgi_app

    secret = "test-only-proxy-secret"
    secret_file = tmp_path / "dev-proxy-token"
    secret_file.write_text(secret, encoding="utf-8")
    monkeypatch.setenv("ORDIVANT_DEV_PROXY_TOKEN_FILE", str(secret_file))
    monkeypatch.delenv("ORDIVANT_DEV_PROXY_TOKEN", raising=False)
    with TestClient(asgi_app, client=("192.0.2.45", 51000)) as proxy_client:
        denied = proxy_client.post("/api/auth/local-session", json={}, headers={"X-Ordivant-Dev-Proxy": "wrong"})
        assert denied.status_code == 403
        allowed = proxy_client.post("/api/auth/local-session", json={}, headers={"X-Ordivant-Dev-Proxy": secret})
        assert allowed.status_code == 200
        monkeypatch.setenv("ORDIVANT_MODE", "production")
        production = proxy_client.post("/api/auth/local-session", json={}, headers={"X-Ordivant-Dev-Proxy": secret})
        assert production.status_code == 403


def test_health_and_gitea_errors_do_not_disclose_config_secrets(api, monkeypatch):
    from ordivant_code import gitea
    from ordivant_code.service import _safe_upstream_url
    from ordivant_code.config import GiteaConfig
    from ordivant_code.errors import DomainError

    sentinel = "do-not-return-gitea-token"
    monkeypatch.setenv("ORDIVANT_CODE_GITEA_URL", "http://127.0.0.1:3001")
    monkeypatch.setenv("ORDIVANT_CODE_GITEA_TOKEN", sentinel)
    monkeypatch.setenv("ORDIVANT_CODE_WEBHOOK_SECRET", "private-hook-key")
    health = api.get("/api/health")
    assert health.status_code == 200
    assert health.json()["gitea_configured"] is True
    assert sentinel not in health.text
    assert "private-hook-key" not in health.text

    assert _safe_upstream_url(f"http://user:{sentinel}@gitea.example/repo") == ""

    class Response:
        status_code = 403
        content = b'{"message":"do-not-return-gitea-token"}'

    class Client:
        def __init__(self, **kwargs):
            self.headers = kwargs["headers"]

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def request(self, *_args, **_kwargs):
            return Response()

    monkeypatch.setattr(gitea.httpx, "Client", Client)
    with pytest.raises(DomainError) as rejected:
        gitea.GiteaClient(GiteaConfig("http://127.0.0.1:3001", sentinel, "hook-secret")).user()
    assert sentinel not in str(rejected.value)


def test_seeded_tokens_are_not_stored_in_plaintext(api, credentials):
    from ordivant_code.models import AuthToken

    with SessionLocal() as session:
        hashes = set(session.scalars(select(AuthToken.token_hash)).all())
    for key in ("manager_token", "writer_token", "reader_token"):
        token = credentials[key]
        assert token not in hashes
        assert token_hash(token) in hashes


def test_database_url_secret_file_is_stripped_and_normalized(monkeypatch, tmp_path):
    from ordivant_code.config import database_url

    url_file = tmp_path / "database-url"
    url_file.write_text("  postgresql://code_user:private-value@db.internal/ordivant  \n", encoding="utf-8")
    monkeypatch.delenv("ORDIVANT_CODE_DATABASE_URL", raising=False)
    monkeypatch.setenv("ORDIVANT_CODE_DATABASE_URL_FILE", str(url_file))
    assert database_url() == "postgresql+psycopg://code_user:private-value@db.internal/ordivant"
