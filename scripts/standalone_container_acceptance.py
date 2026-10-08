"""Black-box acceptance for a Knowledge-only Production Compose project."""

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
from urllib.parse import urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[1]
PROJECT_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
EXPECTED_SERVICES = {"knowledge-api", "knowledge-db", "identity-api", "identity-db", "web"}


class AcceptanceError(RuntimeError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AcceptanceError(message)


def _port(value: str | int) -> int:
    try:
        port = int(value)
    except (TypeError, ValueError):
        raise AcceptanceError("Invalid web port") from None
    require(1 <= port <= 65535, "Invalid web port")
    return port


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
        raise AcceptanceError("Docker Compose command could not complete") from None
    if result.returncode:
        operation = arguments[0] if arguments else "command"
        raise AcceptanceError(f"Docker Compose {operation} failed; diagnostics suppressed")
    return result


def _compose_environment(project: str, web_port: int) -> dict[str, str]:
    environment = os.environ.copy()
    environment.update(
        {
            "ORDIVANT_SECRETS_DIR": str(ROOT / ".data" / "container-secrets" / project).replace("\\", "/"),
            "ORDIVANT_IMAGE_PREFIX": project,
            "ORDIVANT_IMAGE_TAG": environment.get("ORDIVANT_IMAGE_TAG", "local"),
            "ORDIVANT_PRODUCT_MODE": "knowledge",
            "ORDIVANT_WEB_API_UPSTREAM": "http://knowledge-api:8010",
            "ORDIVANT_WEB_PORT": str(web_port),
            "ORDIVANT_RUNTIME_MODE": "demo",
            "ORDIVANT_AUTH_COOKIE_NAME": "ordivant_" + project.replace("-", "_") + "_session",
            "ORDIVANT_AUTH_ORIGINS": f"http://127.0.0.1:{web_port},http://localhost:{web_port}",
        }
    )
    return environment


def _check_running_services(prefix: list[str], environment: dict[str, str]) -> list[str]:
    result = _compose(prefix, environment, ["ps", "--all", "--services"])
    services = sorted({line.strip() for line in result.stdout.splitlines() if line.strip()})
    require(
        set(services) == EXPECTED_SERVICES,
        "Compose project must contain only knowledge-api, knowledge-db, identity-api, identity-db and web",
    )
    return services


def _capture_bootstrap(prefix: list[str], environment: dict[str, str]) -> dict[str, str]:
    code = "import json; from pathlib import Path; print(json.dumps(json.loads(Path('/data/bootstrap.json').read_text(encoding='utf-8'))))"
    result = _compose(prefix, environment, ["exec", "-T", "knowledge-api", "python", "-c", code])
    try:
        bootstrap = json.loads(result.stdout.strip())
    except (json.JSONDecodeError, TypeError):
        raise AcceptanceError("Knowledge bootstrap could not be read from its data volume") from None
    required = (
        "writer_token",
        "reader_token",
        "primary_scope_id",
        "isolated_scope_id",
    )
    require(isinstance(bootstrap, dict) and all(isinstance(bootstrap.get(key), str) and bootstrap[key] for key in required), "Knowledge bootstrap is incomplete")
    return bootstrap


def _request(
    method: str,
    url: str,
    *,
    token: str | None = None,
    body: dict | None = None,
    params: dict[str, str] | None = None,
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
            return client.request(method, url, headers=headers, json=body, params=params)
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


def _wait_health(web_base: str, timeout: int = 90) -> dict:
    deadline = time.monotonic() + timeout
    last_status: int | str = "unavailable"
    while time.monotonic() < deadline:
        try:
            response = _request("GET", web_base + "/api/health", timeout=3)
            if response.is_success:
                return _json(response, "Knowledge health")
            last_status = response.status_code
        except AcceptanceError:
            last_status = "unavailable"
        time.sleep(1)
    raise AcceptanceError(f"Knowledge API did not become healthy after restart ({last_status})")


def _assert_health(web_base: str) -> dict:
    state = _json(_request("GET", web_base + "/api/health"), "Knowledge health")
    require(state.get("status") == "ok", "Knowledge API is not healthy")
    require(state.get("product") == "knowledge", "Knowledge endpoint is not the standalone Knowledge product")
    require(state.get("database") == "postgresql", "Knowledge is not using PostgreSQL")
    require(state.get("mode") == "production", "Knowledge is not in production mode")
    return {"status": "ok", "product": "knowledge", "database": "postgresql", "mode": "production"}


def _assert_identity_readiness(web_base: str) -> dict:
    state = _json(_request("GET", web_base + "/auth-api/status"), "Identity status")
    require(state.get("setup_required") is True, "Identity QA must remain uninitialized for user-owned admin setup")
    return {"status": "ready", "setup_required": True}


def _run_mcp_in_container(
    prefix: list[str],
    environment: dict[str, str],
    *,
    writer_token: str,
    document_id: str,
) -> dict:
    code = r'''import asyncio,json,os,sys
from mcp import ClientSession,StdioServerParameters
from mcp.client.stdio import stdio_client

payload=json.load(sys.stdin)
expected={"list_spaces","search_knowledge","create_document","get_document_context","get_document_version","publish_document_version","record_decision","list_decisions"}

async def check():
    params=StdioServerParameters(command=sys.executable,args=["-m","ordivant_knowledge.mcp_server"],env=dict(os.environ,ORDIVANT_KNOWLEDGE_API_URL="http://127.0.0.1:8010",ORDIVANT_KNOWLEDGE_API_TOKEN=payload["writer_token"]))
    async with stdio_client(params) as (reader,writer):
        async with ClientSession(reader,writer) as session:
            await session.initialize()
            names={item.name for item in (await session.list_tools()).tools}
            if not expected.issubset(names):
                raise RuntimeError("required tools missing")
            result=await session.call_tool("get_document_version",{"document_id":payload["document_id"],"version":1})
            if result.isError or payload["document_id"] not in result.model_dump_json():
                raise RuntimeError("exact-version read failed")
            return {"tool_count":len(names),"exact_version":"passed"}

print(json.dumps(asyncio.run(check())))
'''
    payload = json.dumps({"writer_token": writer_token, "document_id": document_id}, separators=(",", ":"))
    result = _compose(
        prefix,
        environment,
        ["exec", "-T", "knowledge-api", "python", "-c", code],
        stdin=payload,
        timeout=90,
    )
    try:
        value = json.loads(result.stdout.strip())
    except (json.JSONDecodeError, TypeError):
        raise AcceptanceError("Knowledge MCP SDK returned invalid acceptance data") from None
    require(isinstance(value, dict) and value.get("exact_version") == "passed", "Knowledge MCP exact-version read failed")
    return value


def _redact_report(value, secrets: list[str]):
    if isinstance(value, dict):
        return {
            key: _redact_report(item, secrets)
            for key, item in value.items()
            if "token" not in str(key).lower() and "secret" not in str(key).lower()
        }
    if isinstance(value, list):
        return [_redact_report(item, secrets) for item in value]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, "[redacted]")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-name", required=True, help="Existing Knowledge-only Compose project")
    parser.add_argument("--web-port", type=int, default=int(os.getenv("ORDIVANT_WEB_PORT", "8089")), help="Loopback-published Production web port (default: 8089)")
    args = parser.parse_args()
    project = args.project_name.strip().lower()
    require(bool(PROJECT_PATTERN.fullmatch(project)), "Project name must contain lowercase letters, digits, underscores or hyphens")
    web_port = _port(args.web_port)
    web_base = f"http://127.0.0.1:{web_port}"
    report_dir = ROOT / ".data" / "validation" / (f"standalone-knowledge-{project}-" + time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6])
    report_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {"status": "failed", "project_name": project, "mode": "production", "report_directory": str(report_dir)}
    secrets: list[str] = []
    prefix = _compose_prefix(project)
    environment = _compose_environment(project, web_port)
    result_code = 1

    try:
        services = _check_running_services(prefix, environment)
        report["running_services"] = services
        bootstrap = _capture_bootstrap(prefix, environment)
        secrets.extend([bootstrap["writer_token"], bootstrap["reader_token"]])
        report["health"] = _assert_health(web_base)
        report["identity_readiness"] = _assert_identity_readiness(web_base)

        local_session = _request("POST", web_base + "/api/auth/local-session", body={})
        require(local_session.status_code == 403, "Production local-session was not forbidden")
        report["local_session"] = "403"

        writer = bootstrap["writer_token"]
        reader = bootstrap["reader_token"]
        primary_space_id = bootstrap["primary_scope_id"]
        isolated_space_id = bootstrap["isolated_scope_id"]
        spaces_response = _request("GET", web_base + "/api/spaces", token=writer)
        require(spaces_response.is_success, "Writer bearer could not list Knowledge spaces")
        spaces = spaces_response.json()
        require(isinstance(spaces, list) and any(space.get("id") == primary_space_id for space in spaces), "Writer did not receive its primary space")
        reader_spaces = _request("GET", web_base + "/api/spaces", token=reader)
        require(reader_spaces.is_success, "Reader bearer could not list Knowledge spaces")
        isolated = _request("GET", web_base + "/api/spaces/" + isolated_space_id, token=writer)
        require(isolated.status_code in {403, 404}, "Writer bearer accessed the isolated space")
        report["bearer_scope"] = {"writer_primary_space": "readable", "reader_spaces": "readable", "isolated_space": str(isolated.status_code)}

        suffix = uuid.uuid4().hex[:12]
        body_text = f"Standalone Knowledge acceptance document {suffix}. Exact-version content persists across API restart."
        payload = {
            "space_id": primary_space_id,
            "title": "Standalone Knowledge acceptance " + suffix,
            "summary": "Production container acceptance fixture",
            "body": body_text,
            "tags": ["standalone-container-acceptance"],
            "change_summary": "Create a temporary acceptance document",
        }
        idem_key = "standalone-knowledge-" + suffix
        created = _json(_request("POST", web_base + "/api/documents", token=writer, body=payload, key=idem_key), "Create Knowledge document")
        document = created.get("document", {})
        version = created.get("version", {})
        require(document.get("id") and document.get("current_version") == 1, "Knowledge create did not return version 1")
        require(version.get("version") == 1 and version.get("body") == body_text, "Knowledge create returned different exact content")
        replay = _json(_request("POST", web_base + "/api/documents", token=writer, body=payload, key=idem_key), "Idempotent document replay")
        require(replay.get("document", {}).get("id") == document["id"], "Idempotent create duplicated the document")

        exact = _json(_request("GET", web_base + f"/api/documents/{document['id']}/versions/1", token=reader), "Read exact Knowledge version")
        require(exact.get("body") == body_text and exact.get("version") == 1, "Exact Knowledge version differs from the created body")
        require(exact.get("content_sha256") == version.get("content_sha256"), "Exact Knowledge version hash changed")

        search_response = _request(
            "GET",
            web_base + "/api/documents",
            token=reader,
            params={"space_id": primary_space_id, "q": suffix},
        )
        require(search_response.is_success, "Knowledge text search failed")
        search_results = search_response.json()
        require(
            isinstance(search_results, list)
            and any(item.get("id") == document["id"] and item.get("version") == 1 and item.get("uri", "").endswith("/versions/1") for item in search_results),
            "Knowledge text search omitted the created exact-version citation",
        )
        reader_write = _request("POST", web_base + "/api/documents", token=reader, body=payload, key=idem_key + "-reader")
        require(reader_write.status_code == 403, "Reader bearer was allowed to create a document")
        report["document_flow"] = {"document_id": document["id"], "version": 1, "idempotency": "passed", "exact_read": "passed", "search": "passed", "reader_write": "403"}

        report["mcp"] = _run_mcp_in_container(prefix, environment, writer_token=writer, document_id=document["id"])

        _compose(prefix, environment, ["restart", "--timeout", "30", "knowledge-api"], timeout=180)
        health = _wait_health(web_base)
        require(health.get("database") == "postgresql" and health.get("mode") == "production", "Knowledge health changed after restart")
        persisted = _json(_request("GET", web_base + f"/api/documents/{document['id']}/versions/1", token=reader), "Read persisted exact version")
        require(persisted.get("body") == body_text and persisted.get("content_sha256") == exact.get("content_sha256"), "Knowledge document did not persist across API restart")
        report["restart_persistence"] = "passed"
        report["post_restart_health"] = {"database": health["database"], "mode": health["mode"]}
        report["status"] = "passed"
        result_code = 0
    except Exception as error:
        report["error"] = str(error)
    finally:
        try:
            health = _wait_health(web_base, timeout=30)
            report["finally_readiness"] = "passed" if health.get("status") == "ok" else "failed"
        except Exception:
            report["finally_readiness"] = "failed"
            report["status"] = "failed"
            report["error"] = "Knowledge API did not recover to healthy state"
        safe_report = _redact_report(report, secrets)
        try:
            (report_dir / "report.json").write_text(json.dumps(safe_report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        except OSError:
            safe_report["report_write"] = "failed"
        print(json.dumps(safe_report, ensure_ascii=False, indent=2), file=sys.stdout if safe_report.get("status") == "passed" else sys.stderr)
        if safe_report.get("status") != "passed":
            result_code = 1
    return result_code


if __name__ == "__main__":
    raise SystemExit(main())
