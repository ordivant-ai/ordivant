"""Read existing VCS evidence directly; optional Code service is never consulted."""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
from urllib.parse import quote

import httpx

from .errors import DomainError

PROVIDERS = {"github", "gitlab", "gitea"}
REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+\Z")


def connection(project_id: str, provider: str, repository: str) -> dict:
    if provider not in PROVIDERS or not REPOSITORY.fullmatch(repository) or any(part in {".", ".."} for part in repository.split("/")):
        raise DomainError(422, "invalid_vcs_reference", "版控來源或倉庫識別碼無效")
    if provider != "gitlab" and repository.count("/") != 1:
        raise DomainError(422, "invalid_vcs_reference", "此版控來源需要 owner/repository")
    configured = os.getenv("ORDIVANT_VCS_CONFIG")
    if not configured:
        raise DomainError(503, "vcs_not_configured", "此 Work 專案尚未設定既有版控連線")
    try:
        config = json.loads(Path(configured).read_text(encoding="utf-8"))
        selected = config.get("projects", {}).get(project_id, {}).get(provider)
        if not isinstance(selected, dict):
            raise DomainError(503, "vcs_not_configured", "此 Work 專案尚未設定此版控來源")
        if repository not in selected.get("repositories", []):
            raise DomainError(403, "vcs_repository_scope", "此倉庫不在 Work 專案的版控授權範圍")
        url = httpx.URL(selected["api_url"])
        http_hosts = {"127.0.0.1", "localhost", "::1"}
        http_hosts.update(host.strip().lower() for host in os.getenv("ORDIVANT_VCS_HTTP_HOSTS", "").split(",") if host.strip())
        if url.userinfo or url.query or url.fragment or not url.host or (url.scheme != "https" and not (url.scheme == "http" and url.host in http_hosts)):
            raise ValueError("invalid configured API URL")
        return selected
    except DomainError:
        raise
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        raise DomainError(503, "vcs_configuration_error", "Work 版控連線設定無效") from None


def _client(**kwargs) -> httpx.Client:
    return httpx.Client(timeout=10, trust_env=False, follow_redirects=False, **kwargs)


def inspect_pull(project_id: str, provider: str, repository: str, number: int) -> dict:
    config = connection(project_id, provider, repository)
    if number < 1:
        raise DomainError(422, "invalid_vcs_reference", "PR/MR 編號須大於零")
    headers = {"Accept": "application/json"}
    if config.get("token"):
        key = "PRIVATE-TOKEN" if provider == "gitlab" else "Authorization"
        value = config["token"] if provider == "gitlab" else ("token " if provider == "gitea" else "Bearer ") + config["token"]
        headers[key] = value
    if provider == "github":
        headers["Accept"] = "application/vnd.github+json"
    if provider == "gitlab":
        path = f"/projects/{quote(repository, safe='')}/merge_requests/{number}"
    else:
        path = f"/repos/{repository}/pulls/{number}"
    try:
        with _client(base_url=config["api_url"].rstrip("/") + "/", headers=headers) as client:
            response = client.get(path.lstrip("/"))
            if response.status_code == 404:
                raise DomainError(404, "vcs_pull_not_found", "上游找不到此 PR/MR")
            if not response.is_success:
                raise DomainError(502, "vcs_upstream_error", f"上游版控回傳 HTTP {response.status_code}")
            pull = response.json()
            if provider == "gitlab":
                sha = pull["sha"]
                head, base = pull["source_branch"], pull["target_branch"]
                web_url, state = pull["web_url"], pull["state"]
                checks_path = path + "/pipelines"
            else:
                sha = pull["head"]["sha"]
                head, base = pull["head"]["ref"], pull["base"]["ref"]
                web_url, state = pull["html_url"], "merged" if pull.get("merged") else pull["state"]
                checks_path = f"/repos/{repository}/" + (f"commits/{sha}/status" if provider == "github" else f"statuses/{sha}")
            checks_response = client.get(checks_path.lstrip("/"))
            checks = []
            checks_available = checks_response.is_success
            if checks_available:
                raw = checks_response.json()
                records = raw.get("statuses", []) if provider == "github" else raw
                if not isinstance(records, list):
                    raise ValueError("invalid upstream checks")
                for item in records:
                    checks.append({"context": item.get("context", "pipeline/" + str(item.get("id", ""))), "state": item.get("state", item.get("status", "unknown")), "description": item.get("description", ""), "target_url": item.get("target_url", item.get("web_url"))})
            return {"provider": provider, "repository": repository, "number": number, "title": pull["title"], "state": state, "web_url": web_url, "head_sha": sha, "head": head, "base": base, "checks": checks, "checks_available": checks_available, "source": "provider_api"}
    except DomainError:
        raise
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        # Upstream bodies and URLs may contain credentials; surface only a stable domain error.
        raise DomainError(502, "vcs_upstream_error", "無法取得上游版控證據") from None
