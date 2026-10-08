from __future__ import annotations

import base64
from urllib.parse import quote

import httpx

from .config import GiteaConfig
from .errors import DomainError


class GiteaClient:
    def __init__(self, config: GiteaConfig):
        self.config = config

    def request(self, method: str, endpoint: str, *, params=None, json_body=None):
        try:
            with httpx.Client(
                timeout=httpx.Timeout(20.0, connect=5.0),
                headers={"Authorization": f"token {self.config.token}", "Accept": "application/json"},
            ) as client:
                response = client.request(method, self.config.api_base + endpoint, params=params, json=json_body)
        except httpx.HTTPError as exc:
            raise DomainError(502, "gitea_unavailable", "Gitea could not complete the request") from exc
        if response.status_code >= 400:
            if response.status_code == 404:
                code = "gitea_resource_not_found"
                status = 404
            elif response.status_code in {409, 422}:
                code = "gitea_conflict"
                status = 409
            else:
                code = "gitea_upstream_error"
                status = 502
            raise DomainError(status, code, "Gitea rejected the request")
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as exc:
            raise DomainError(502, "gitea_invalid_response", "Gitea returned an invalid response") from exc

    @staticmethod
    def repo_path(owner: str, repo: str) -> str:
        return f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}"

    def user(self) -> dict:
        return self.request("GET", "/user")

    def repository(self, owner: str, repo: str) -> dict:
        return self.request("GET", self.repo_path(owner, repo))

    def create_repository(self, *, name: str, description: str):
        return self.request(
            "POST",
            "/user/repos",
            json_body={"name": name, "description": description, "private": True, "auto_init": True, "default_branch": "main"},
        )

    def branch(self, owner: str, repo: str, name: str) -> dict:
        return self.request("GET", f"{self.repo_path(owner, repo)}/branches/{quote(name, safe='')}")

    def create_branch(self, owner: str, repo: str, name: str, from_branch: str):
        return self.request(
            "POST",
            f"{self.repo_path(owner, repo)}/branches",
            json_body={"new_branch_name": name, "old_branch_name": from_branch},
        )

    def file(self, owner: str, repo: str, path: str, ref: str) -> dict:
        endpoint = f"{self.repo_path(owner, repo)}/contents/{quote(path, safe='/')}"
        return self.request("GET", endpoint, params={"ref": ref})

    def commit_file(self, owner: str, repo: str, *, path: str, branch: str, content: str, message: str, sha: str | None):
        endpoint = f"{self.repo_path(owner, repo)}/contents/{quote(path, safe='/')}"
        data = {"message": message, "content": base64.b64encode(content.encode("utf-8")).decode("ascii"), "branch": branch}
        if sha:
            data["sha"] = sha
            method = "PUT"
        else:
            method = "POST"
        return self.request(method, endpoint, json_body=data)

    def commits_for_path(self, owner: str, repo: str, path: str, branch: str):
        return self.request(
            "GET",
            f"{self.repo_path(owner, repo)}/commits",
            params={"path": path, "sha": branch, "limit": 100},
        )

    def statuses(self, owner: str, repo: str, sha: str):
        return self.request(
            "GET",
            f"{self.repo_path(owner, repo)}/commits/{quote(sha, safe='')}/statuses",
            params={"limit": 100},
        )

    def pulls(self, owner: str, repo: str):
        return self.request("GET", f"{self.repo_path(owner, repo)}/pulls", params={"state": "all", "limit": 100})

    def create_pull(self, owner: str, repo: str, *, head: str, base: str, title: str, body: str):
        return self.request(
            "POST",
            f"{self.repo_path(owner, repo)}/pulls",
            json_body={"head": head, "base": base, "title": title, "body": body},
        )

    def pull(self, owner: str, repo: str, number: int):
        return self.request("GET", f"{self.repo_path(owner, repo)}/pulls/{number}")

    def create_status(self, owner: str, repo: str, *, sha: str, context: str, state: str, description: str, target_url: str | None):
        return self.request(
            "POST",
            f"{self.repo_path(owner, repo)}/statuses/{quote(sha, safe='')}",
            json_body={"context": context, "state": state, "description": description, "target_url": target_url},
        )
