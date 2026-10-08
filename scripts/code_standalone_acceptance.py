"""Black-box acceptance for an already-running Code-only Production Compose project."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid
from urllib.parse import urljoin, urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[1]
EXPECTED_SERVICES = {"code-api", "code-db", "identity-api", "identity-db", "web"}
PROJECT_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
EXPECTED_MCP_TOOLS = {
    "list_code_projects",
    "list_repositories",
    "create_repository",
    "create_branch",
    "commit_file",
    "create_pull_request",
    "get_pull_request",
    "report_check",
    "get_code_events",
}


class AcceptanceError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AcceptanceError(message)


def _port(value: str | int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise AcceptanceError("Invalid web port") from None
    require(1 <= parsed <= 65535, "Invalid web port")
    return parsed


def _compose_prefix(project: str) -> list[str]:
    return [
        "docker",
        "compose",
        "--project-directory",
        str(ROOT),
        "--project-name",
        project,
        "--file",
        str(ROOT / "compose.yaml"),
    ]


def _compose(
    prefix: list[str],
    environment: dict[str, str],
    arguments: list[str],
    *,
    stdin: str | None = None,
    timeout: int = 120,
    operation: str,
) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(
            prefix + arguments,
            cwd=ROOT,
            env=environment,
            input=stdin,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise AcceptanceError(f"Docker Compose {operation} could not complete") from None
    if result.returncode:
        raise AcceptanceError(f"Docker Compose {operation} failed; see local Docker diagnostics")
    return result


def _compose_environment(project: str, web_port: int) -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(
        {
            "ORDIVANT_SECRETS_DIR": str(ROOT / ".data" / "container-secrets" / project).replace("\\", "/"),
            "ORDIVANT_IMAGE_PREFIX": project,
            "ORDIVANT_IMAGE_TAG": environment.get("ORDIVANT_IMAGE_TAG", "local"),
            "ORDIVANT_PRODUCT_MODE": "code",
            "ORDIVANT_WEB_API_UPSTREAM": "http://code-api:8020",
            "ORDIVANT_WEB_PORT": str(web_port),
            "ORDIVANT_RUNTIME_MODE": "demo",
            "ORDIVANT_AUTH_COOKIE_NAME": "ordivant_" + project.replace("-", "_") + "_session",
            "ORDIVANT_AUTH_ORIGINS": f"http://127.0.0.1:{web_port},http://localhost:{web_port}",
        }
    )
    return environment


def _running_services(prefix: list[str], environment: dict[str, str]) -> list[str]:
    result = _compose(
        prefix,
        environment,
        ["ps", "--all", "--format", "json"],
        operation="inspect running services",
    )
    raw = result.stdout.strip()
    try:
        parsed = json.loads(raw)
        rows = parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        try:
            rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
        except json.JSONDecodeError:
            raise AcceptanceError("Compose service status was not valid JSON") from None

    services: list[str] = []
    running: list[bool] = []
    for row in rows:
        if not isinstance(row, dict):
            raise AcceptanceError("Compose service status has an invalid shape")
        service = row.get("Service") or row.get("service")
        state = str(row.get("State") or row.get("state") or "").lower()
        status = str(row.get("Status") or row.get("status") or "").lower()
        services.append(str(service or ""))
        running.append(state == "running" or status.startswith("up "))

    require(
        len(services) == len(EXPECTED_SERVICES)
        and set(services) == EXPECTED_SERVICES
        and all(running),
        "Compose project must have exactly five running services: code-api, code-db, identity-api, identity-db and web",
    )
    return sorted(services)


def _capture_bootstrap(prefix: list[str], environment: dict[str, str]) -> dict[str, str]:
    code = (
        "import json; from pathlib import Path; "
        "print(json.dumps(json.loads(Path('/data/bootstrap.json').read_text(encoding='utf-8'))))"
    )
    result = _compose(
        prefix,
        environment,
        ["exec", "-T", "code-api", "python", "-c", code],
        operation="capture Code bootstrap in process memory",
    )
    try:
        bootstrap = json.loads(result.stdout.strip())
    except (json.JSONDecodeError, TypeError):
        raise AcceptanceError("Code bootstrap could not be read from its data volume") from None
    required = (
        "manager_token",
        "writer_token",
        "reader_token",
        "primary_scope_id",
        "isolated_scope_id",
    )
    require(
        isinstance(bootstrap, dict)
        and all(isinstance(bootstrap.get(key), str) and bootstrap[key] for key in required),
        "Code bootstrap is incomplete",
    )
    return bootstrap


def _request(
    method: str,
    url: str,
    *,
    token: str | None = None,
    body: dict | None = None,
    key: str | None = None,
    timeout: float = 12,
) -> httpx.Response:
    headers: dict[str, str] = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if key:
        headers["Idempotency-Key"] = key
    try:
        with httpx.Client(timeout=timeout, trust_env=False, follow_redirects=False) as client:
            return client.request(method, url, headers=headers, json=body)
    except httpx.HTTPError:
        raise AcceptanceError(f"HTTP request failed: {method} {urlsplit(url).path}") from None


def _json(response: httpx.Response, label: str) -> dict:
    require(response.is_success, f"{label} returned HTTP {response.status_code}")
    try:
        value = response.json()
    except ValueError:
        raise AcceptanceError(f"{label} returned invalid JSON") from None
    require(isinstance(value, dict), f"{label} returned an invalid response")
    return value


def _json_list(response: httpx.Response, label: str) -> list[dict]:
    require(response.is_success, f"{label} returned HTTP {response.status_code}")
    try:
        value = response.json()
    except ValueError:
        raise AcceptanceError(f"{label} returned invalid JSON") from None
    require(isinstance(value, list) and all(isinstance(item, dict) for item in value), f"{label} returned an invalid list")
    return value


def _wait_health(web_base: str, timeout: int = 90) -> dict:
    deadline = time.monotonic() + timeout
    last_status: int | str = "unavailable"
    while time.monotonic() < deadline:
        try:
            response = _request("GET", web_base + "/api/health", timeout=3)
            if response.is_success:
                return _json(response, "Code health")
            last_status = response.status_code
        except AcceptanceError:
            last_status = "unavailable"
        time.sleep(1)
    raise AcceptanceError(f"Code API did not become healthy ({last_status})")


def _assert_health(web_base: str) -> dict:
    state = _json(_request("GET", web_base + "/api/health"), "Code health")
    require(state.get("status") == "ok", "Code API is not healthy")
    require(state.get("product") == "code", "Health endpoint is not the Code product")
    require(state.get("database") == "postgresql", "Code is not using PostgreSQL")
    require(state.get("mode") == "production", "Code is not in production mode")
    require(state.get("gitea_configured") is False, "Standalone Code QA should be unconfigured with Gitea")
    return {"status": "ok", "product": "code", "database": "postgresql", "mode": "production", "gitea_configured": False}


def _assert_identity_readiness(web_base: str) -> dict:
    state = _json(_request("GET", web_base + "/auth-api/status"), "Identity status")
    require(state.get("setup_required") is True, "Identity QA must remain uninitialized for user-owned admin setup")
    return {"status": "ready", "setup_required": True}


def _assert_standalone_code_build(web_base: str) -> dict:
    response = _request("GET", web_base + "/")
    require(response.is_success, "Standalone Code web page is not reachable")
    require("text/html" in response.headers.get("content-type", "").lower(), "Web root did not return HTML")
    html = response.text
    require("/src/main.tsx" not in html, "Web root served a development entry point")
    match = re.search(r'<script[^>]+src=["\']([^"\']+\.js)["\']', html)
    require(match is not None, "Standalone web HTML has no JavaScript bundle")
    main_url = urljoin(web_base.rstrip("/") + "/", match.group(1))
    main_response = _request("GET", main_url)
    require(main_response.is_success, "Standalone web JavaScript bundle is not reachable")
    router_paths = re.findall(
        r'import\(\s*["\']([^"\']*ProductRouter-[^"\']+\.js)["\']\s*\)',
        main_response.text,
    )
    require(len(router_paths) == 1, "Web entry does not load one standalone product router")
    router_url = urljoin(main_url, router_paths[0])
    router_response = _request("GET", router_url)
    require(router_response.is_success, "Standalone product router is not reachable")
    code_chunks = re.findall(r"CodeApp-[A-Za-z0-9_-]+\.js", router_response.text)
    other_product_chunks = re.findall(r"(?:KnowledgeApp|ProductSwitcher)-[A-Za-z0-9_-]+\.js|(?:^|[^A-Za-z])App-[A-Za-z0-9_-]+\.js", router_response.text)
    unique_code_chunks = sorted(set(code_chunks))
    require(len(unique_code_chunks) == 1 and not other_product_chunks, "Web bundle is not the standalone Code build")
    code_response = _request("GET", urljoin(router_url, "./" + unique_code_chunks[0]))
    require(code_response.is_success and code_response.content, "Standalone Code application bundle is not reachable")
    return {"html": "passed", "standalone_product_chunk": "CodeApp", "other_product_chunks": 0}


def _assert_local_session_forbidden(web_base: str) -> int:
    response = _request("POST", web_base + "/api/auth/local-session", body={})
    require(response.status_code == 403, "Production local-session was not forbidden")
    return response.status_code


def _assert_scope_access(web_base: str, bootstrap: dict[str, str]) -> tuple[str, dict]:
    manager_projects = _json_list(
        _request("GET", web_base + "/api/projects", token=bootstrap["manager_token"]),
        "Manager project list",
    )
    writer_projects = _json_list(
        _request("GET", web_base + "/api/projects", token=bootstrap["writer_token"]),
        "Writer project list",
    )
    reader_projects = _json_list(
        _request("GET", web_base + "/api/projects", token=bootstrap["reader_token"]),
        "Reader project list",
    )
    manager_by_key = {item.get("key"): item for item in manager_projects}
    primary = manager_by_key.get("code-demo")
    isolated = manager_by_key.get("code-isolated-demo")
    require(primary is not None and isolated is not None, "Seeded Code projects are missing")
    require({"code-demo", "code-isolated-demo"}.issubset(manager_by_key), "Manager does not see both seeded Code projects")
    require([item.get("key") for item in writer_projects] == ["code-demo"], "Writer scope is not limited to the primary project")
    require([item.get("key") for item in reader_projects] == ["code-demo"], "Reader scope is not limited to the primary project")
    isolated_access = _request(
        "GET",
        web_base + "/api/projects/" + isolated["id"],
        token=bootstrap["writer_token"],
    )
    require(isolated_access.status_code in {403, 404}, "Writer accessed the isolated Code project")
    return primary["id"], {
        "manager_projects": len(manager_projects),
        "writer_projects": len(writer_projects),
        "reader_projects": len(reader_projects),
        "writer_isolated_project_status": isolated_access.status_code,
    }


def _assert_reader_write_forbidden(web_base: str, bootstrap: dict[str, str], suffix: str) -> int:
    response = _request(
        "POST",
        web_base + "/api/projects",
        token=bootstrap["reader_token"],
        key="code-standalone-reader-" + suffix,
        body={"key": "reader-" + suffix, "name": "Reader write authorization check"},
    )
    require(response.status_code == 403, "Reader was not forbidden from creating a Code project")
    return response.status_code


def _create_manager_project(web_base: str, bootstrap: dict[str, str], suffix: str) -> dict:
    payload = {
        "key": "qa-" + suffix,
        "name": "Standalone Code acceptance " + suffix,
        "description": "Local production-container persistence acceptance.",
    }
    result = _json(
        _request(
            "POST",
            web_base + "/api/projects",
            token=bootstrap["manager_token"],
            body=payload,
            key="code-standalone-manager-" + suffix,
        ),
        "Manager project creation",
    )
    require(result.get("key") == payload["key"] and result.get("name") == payload["name"], "Manager project creation returned different project data")
    return {"id": result["id"], "key": result["key"]}


def _assert_restart_persistence(web_base: str, bootstrap: dict[str, str], created_project: dict) -> dict:
    health = _wait_health(web_base)
    require(
        health.get("product") == "code"
        and health.get("database") == "postgresql"
        and health.get("mode") == "production"
        and health.get("gitea_configured") is False,
        "Code health changed after API restart",
    )
    project = _json(
        _request(
            "GET",
            web_base + "/api/projects/" + created_project["id"],
            token=bootstrap["manager_token"],
        ),
        "Read manager-created project after restart",
    )
    require(project.get("key") == created_project["key"], "Manager-created project did not persist across API restart")
    return {"manager_project": "persisted", "api_health": "ready"}


def _assert_gitea_unconfigured_write(web_base: str, bootstrap: dict[str, str], project_id: str, suffix: str) -> dict:
    response = _request(
        "POST",
        web_base + "/api/repositories",
        token=bootstrap["writer_token"],
        key="code-standalone-no-gitea-" + suffix,
        body={
            "project_id": project_id,
            "name": "qa-" + suffix,
            "description": "This write must remain unavailable while Gitea is unconfigured.",
            "private": True,
        },
    )
    require(response.status_code == 503, "Repository creation did not return HTTP 503 without Gitea")
    try:
        detail = response.json().get("detail", {})
    except (ValueError, AttributeError):
        detail = {}
    require(isinstance(detail, dict) and detail.get("code") == "gitea_not_configured", "Repository creation did not report gitea_not_configured")
    return {"status": response.status_code, "code": "gitea_not_configured"}


def _run_mcp_in_container(prefix: list[str], environment: dict[str, str]) -> dict:
    code = r'''import asyncio,json,os,sys
from pathlib import Path
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client

expected={"list_code_projects","list_repositories","create_repository","create_branch","commit_file","create_pull_request","get_pull_request","report_check","get_code_events"}

def find_list(value):
    if isinstance(value,list):
        return value
    if isinstance(value,dict):
        for item in value.values():
            found=find_list(item)
            if found is not None:
                return found
    return None

def result_list(result,label):
    if result.isError:
        raise RuntimeError(label+" returned an MCP error")
    found=find_list(getattr(result,"structuredContent",None))
    if found is None:
        for item in result.content:
            text=getattr(item,"text",None)
            if text is None:
                continue
            try:
                found=find_list(json.loads(text))
            except json.JSONDecodeError:
                continue
            if found is not None:
                break
    if found is None:
        raise RuntimeError(label+" returned no list result")
    return found

async def run():
    bootstrap=json.loads(Path("/data/bootstrap.json").read_text(encoding="utf-8"))
    params=StdioServerParameters(
        command=sys.executable,
        args=["-m","ordivant_code.mcp_server"],
        env=dict(os.environ,ORDIVANT_CODE_API_URL="http://127.0.0.1:8020",ORDIVANT_CODE_API_TOKEN=bootstrap["writer_token"]),
    )
    async with stdio_client(params) as (reader,writer):
        async with ClientSession(reader,writer) as session:
            await session.initialize()
            names={tool.name for tool in (await session.list_tools()).tools}
            if names != expected:
                raise RuntimeError("MCP tool list does not match the nine Code tools")
            projects=result_list(await session.call_tool("list_code_projects",{}),"list_code_projects")
            primary=next((item for item in projects if item.get("key")=="code-demo"),None)
            if primary is None:
                raise RuntimeError("MCP did not return the seeded primary project")
            repositories=result_list(
                await session.call_tool("list_repositories",{"project_id":primary["id"]}),
                "list_repositories",
            )
            events=result_list(
                await session.call_tool("get_code_events",{"project_id":primary["id"]}),
                "get_code_events",
            )
            return {"tool_names":sorted(names),"repository_count":len(repositories),"event_count":len(events)}

print(json.dumps(asyncio.run(run()),separators=(",",":")))
'''
    result = _compose(
        prefix,
        environment,
        ["exec", "-T", "code-api", "python", "-"],
        stdin=code,
        timeout=90,
        operation="run official Code MCP stdio acceptance",
    )
    try:
        value = json.loads(result.stdout.strip())
    except (json.JSONDecodeError, TypeError):
        raise AcceptanceError("Code MCP stdio acceptance returned invalid output") from None
    require(isinstance(value, dict), "Code MCP stdio acceptance returned an invalid result")
    require(value.get("tool_names") == sorted(EXPECTED_MCP_TOOLS), "Code MCP did not list exactly nine tools")
    require(isinstance(value.get("repository_count"), int), "Code MCP repository read did not return a list")
    require(isinstance(value.get("event_count"), int), "Code MCP event read did not return a list")
    return {"tool_count": 9, "repository_read": "passed", "event_read": "passed"}


def _run_check(report: dict, name: str, action):
    try:
        value = action()
    except Exception:
        report.setdefault("checks", {})[name] = "failed"
        report["failed_predicate"] = name
        raise
    report.setdefault("checks", {})[name] = "passed"
    return value


def _redact_report(value, secrets: list[str]):
    if isinstance(value, dict):
        return {
            key: _redact_report(item, secrets)
            for key, item in value.items()
            if not any(part in str(key).lower() for part in ("token", "secret", "password", "credential"))
        }
    if isinstance(value, list):
        return [_redact_report(item, secrets) for item in value]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[redacted]")
        value = re.sub(r"(?i)(\b[a-z][a-z0-9+.-]*://)[^\s/@]+@", r"\1[redacted]@", value)
        value = re.sub(r"(?i)(?<![a-f0-9])[a-f0-9]{40,128}(?![a-f0-9])", "[redacted]", value)
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-name", required=True, help="Existing Code-only Compose project")
    parser.add_argument(
        "--web-port",
        type=int,
        default=int(os.getenv("ORDIVANT_WEB_PORT", "8091")),
        help="Loopback-published Production web port (default: 8091)",
    )
    args = parser.parse_args()
    project = args.project_name.strip().lower()
    require(bool(PROJECT_PATTERN.fullmatch(project)), "Project name must contain lowercase letters, digits, underscores or hyphens")
    web_port = _port(args.web_port)
    web_base = f"http://127.0.0.1:{web_port}"
    suffix = uuid.uuid4().hex[:12]
    report_dir = ROOT / ".data" / "validation" / (
        f"standalone-code-{project}-" + time.strftime("%Y%m%d-%H%M%S") + "-" + suffix[:6]
    )
    report_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {
        "status": "failed",
        "project_name": project,
        "mode": "production",
        "report_directory": str(report_dir),
        "expected_services": sorted(EXPECTED_SERVICES),
        "checks": {},
    }
    environment = _compose_environment(project, web_port)
    prefix = _compose_prefix(project)
    secrets: list[str] = []
    result_code = 1

    try:
        report["running_services"] = _run_check(report, "exact_running_services", lambda: _running_services(prefix, environment))
        report["web_build"] = _run_check(report, "standalone_code_web_build", lambda: _assert_standalone_code_build(web_base))

        bootstrap = _run_check(report, "bootstrap_capture", lambda: _capture_bootstrap(prefix, environment))
        secrets.extend(bootstrap[key] for key in ("manager_token", "writer_token", "reader_token"))
        report["health"] = _run_check(report, "production_health", lambda: _assert_health(web_base))
        report["identity_readiness"] = _run_check(
            report,
            "identity_admin_setup_required",
            lambda: _assert_identity_readiness(web_base),
        )

        report["local_session_status"] = _run_check(
            report,
            "local_session_forbidden",
            lambda: _assert_local_session_forbidden(web_base),
        )

        primary_project_id, scope_report = _run_check(
            report,
            "project_scope_access",
            lambda: _assert_scope_access(web_base, bootstrap),
        )
        report["project_scope"] = scope_report
        report["reader_write_status"] = _run_check(
            report,
            "reader_write_forbidden",
            lambda: _assert_reader_write_forbidden(web_base, bootstrap, suffix),
        )

        report["manager_project"] = _run_check(
            report,
            "manager_project_create",
            lambda: _create_manager_project(web_base, bootstrap, suffix),
        )
        report["gitea_unconfigured_write"] = _run_check(
            report,
            "gitea_write_returns_explicit_503",
            lambda: _assert_gitea_unconfigured_write(web_base, bootstrap, primary_project_id, suffix),
        )
        report["mcp"] = _run_check(report, "official_mcp_stdio_round_trip", lambda: _run_mcp_in_container(prefix, environment))

        _run_check(
            report,
            "restart_code_api_only",
            lambda: _compose(
                prefix,
                environment,
                ["restart", "--timeout", "30", "code-api"],
                timeout=180,
                operation="restart only the Code API",
            ),
        )
        report["restart_persistence"] = _run_check(
            report,
            "manager_project_persisted_after_restart",
            lambda: _assert_restart_persistence(web_base, bootstrap, report["manager_project"]),
        )
        report["status"] = "passed"
        result_code = 0
    except Exception as error:
        report["error"] = str(error)
    finally:
        try:
            _wait_health(web_base, timeout=45)
            _assert_health(web_base)
            report["finally_readiness"] = "passed"
            report.setdefault("checks", {})["finally_readiness"] = "passed"
        except Exception:
            report["finally_readiness"] = "failed"
            report.setdefault("checks", {})["finally_readiness"] = "failed"
            report["status"] = "failed"
            report.setdefault("failed_predicate", "finally_readiness")
            report["error"] = report.get("error") or "Code API did not recover to a healthy state"
            result_code = 1

        safe_report = _redact_report(report, secrets)
        try:
            (report_dir / "report.json").write_text(json.dumps(safe_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        except OSError:
            safe_report["report_write"] = "failed"
        print(
            json.dumps(safe_report, ensure_ascii=False, indent=2),
            file=sys.stdout if safe_report.get("status") == "passed" else sys.stderr,
        )
        if safe_report.get("status") != "passed":
            result_code = 1
    return result_code


if __name__ == "__main__":
    raise SystemExit(main())
