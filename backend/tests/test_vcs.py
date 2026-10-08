from __future__ import annotations

import json

import httpx
import pytest

from ordivant import vcs

from conftest import headers
from fastapi.testclient import TestClient
from ordivant.api import app


def configured(tmp_path, monkeypatch, system, provider="gitea"):
    path = tmp_path / "vcs.json"
    path.write_text(json.dumps({"projects": {system["ids"]["project"]: {provider: {"api_url": "http://127.0.0.1:3001/api/v1", "token": "upstream-secret-test", "repositories": ["team/repo"]}}}}), encoding="utf-8")
    monkeypatch.setenv("ORDIVANT_VCS_CONFIG", str(path))


def test_vcs_project_and_repository_authorization_before_network(api_client, system, tmp_path, monkeypatch):
    configured(tmp_path, monkeypatch, system)
    monkeypatch.setattr(vcs, "_client", lambda **_: pytest.fail("Denied reference performed a network request"))
    path = f"/api/projects/{system['ids']['project']}/vcs/pulls/gitea/1"
    assert api_client.get(path, params={"repository": "team/repo"}, headers=headers(system, "outsider")).status_code == 404
    assert api_client.get(path, params={"repository": "other/private"}, headers=headers(system, "worker_a")).status_code == 403
    assert api_client.get(path, params={"repository": "../private"}, headers=headers(system, "worker_a")).status_code == 422
    assert api_client.get(path, params={"repository": "https://evil.invalid/repo"}, headers=headers(system, "worker_a")).status_code == 422
    assert api_client.get(path, params={"repository": "team/repo"}, headers=headers(system, "runtime")).status_code == 403


@pytest.mark.parametrize("provider", ["github", "gitlab", "gitea"])
def test_vcs_reads_upstream_without_peer_services(api_client, system, tmp_path, monkeypatch, provider):
    configured(tmp_path, monkeypatch, system, provider)
    calls = []
    pull = {"title": "Actual upstream change", "state": "open", "head": {"sha": "a" * 40, "ref": "feature"}, "base": {"ref": "main"}, "html_url": "https://git.example/team/repo/pulls/7"}
    if provider == "gitlab":
        pull = {"title": pull["title"], "state": "opened", "sha": "a" * 40, "source_branch": "feature", "target_branch": "main", "web_url": "https://git.example/team/repo/-/merge_requests/7"}

    def upstream(request):
        calls.append(request)
        if request.url.path.endswith(("/pulls/7", "/merge_requests/7")):
            return httpx.Response(200, json=pull)
        statuses = [{"context": "ci/tests", "state": "success", "description": "verified"}]
        return httpx.Response(200, json={"statuses": statuses} if provider == "github" else statuses)

    monkeypatch.setattr(vcs, "_client", lambda **kwargs: httpx.Client(transport=httpx.MockTransport(upstream), **kwargs))
    path = f"/api/projects/{system['ids']['project']}/vcs/pulls/{provider}/7"
    response = api_client.get(path, params={"repository": "team/repo"}, headers=headers(system, "worker_a"))
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["source"] == "provider_api" and result["head_sha"] == "a" * 40
    assert result["checks_available"] is True and result["checks"][0]["state"] == "success"
    assert len(calls) == 2 and all(request.url.host == "127.0.0.1" for request in calls)
    assert "upstream-secret-test" not in response.text
    if provider == "gitlab":
        assert b"team%2Frepo" in calls[0].url.raw_path


def test_vcs_missing_configuration_and_partial_checks_are_explicit(api_client, system, tmp_path, monkeypatch):
    path = f"/api/projects/{system['ids']['project']}/vcs/pulls/gitea/1"
    monkeypatch.delenv("ORDIVANT_VCS_CONFIG", raising=False)
    assert api_client.get(path, params={"repository": "team/repo"}, headers=headers(system, "worker_a")).status_code == 503
    configured(tmp_path, monkeypatch, system)

    def upstream(request):
        if request.url.path.endswith("/pulls/1"):
            return httpx.Response(200, json={"title": "PR", "state": "open", "head": {"sha": "a" * 40, "ref": "feature"}, "base": {"ref": "main"}, "html_url": "https://git.example/PR"})
        return httpx.Response(403, text="upstream-secret-test")

    monkeypatch.setattr(vcs, "_client", lambda **kwargs: httpx.Client(transport=httpx.MockTransport(upstream), **kwargs))
    result = api_client.get(path, params={"repository": "team/repo"}, headers=headers(system, "worker_a")).json()
    assert result["checks_available"] is False and result["checks"] == []
    assert "upstream-secret-test" not in json.dumps(result)


def test_development_proxy_requires_secret_and_stays_disabled_in_production(system, tmp_path, monkeypatch):
    path = tmp_path / "proxy-secret"
    path.write_text("generated-test-proxy-secret", encoding="utf-8")
    monkeypatch.setenv("ORDIVANT_DEV_PROXY_TOKEN_FILE", str(path))
    with TestClient(app, client=("172.20.0.5", 40000)) as client:
        assert client.post("/api/auth/local-session", json={}, headers={"X-Forwarded-For": "127.0.0.1", "X-Ordivant-Dev-Proxy": "forged"}).status_code == 403
        assert client.post("/api/auth/local-session", json={}, headers={"X-Ordivant-Dev-Proxy": "generated-test-proxy-secret"}).status_code == 200
        monkeypatch.setenv("ORDIVANT_MODE", "production")
        assert client.post("/api/auth/local-session", json={}, headers={"X-Ordivant-Dev-Proxy": "generated-test-proxy-secret"}).status_code == 403


def test_private_container_http_host_requires_operator_allowlist(tmp_path, monkeypatch, system):
    configured(tmp_path, monkeypatch, system)
    config_path = tmp_path / "vcs.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    provider = config["projects"][system["ids"]["project"]]["gitea"]
    provider["api_url"] = "http://gitea:3000/api/v1"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    monkeypatch.delenv("ORDIVANT_VCS_HTTP_HOSTS", raising=False)
    with pytest.raises(vcs.DomainError) as denied:
        vcs.connection(system["ids"]["project"], "gitea", "team/repo")
    assert denied.value.code == "vcs_configuration_error"
    monkeypatch.setenv("ORDIVANT_VCS_HTTP_HOSTS", "gitea")
    assert vcs.connection(system["ids"]["project"], "gitea", "team/repo")["api_url"] == provider["api_url"]
    provider["api_url"] = "http://other-private-service:3000/api/v1"
    config_path.write_text(json.dumps(config), encoding="utf-8")
    with pytest.raises(vcs.DomainError):
        vcs.connection(system["ids"]["project"], "gitea", "team/repo")
