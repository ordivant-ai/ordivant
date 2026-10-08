#!/usr/bin/env python3
"""Start and black-box check one Ordivant product at a time."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
VALIDATION_ROOT = ROOT / ".data" / "validation"
PRODUCTS = {
    "knowledge": {
        "backend": ROOT / "products" / "knowledge" / "backend",
        "module": "ordivant_knowledge",
        "data_env": "ORDIVANT_KNOWLEDGE_DATA_DIR",
        "api_env": "ORDIVANT_KNOWLEDGE_API_URL",
        "token_env": "ORDIVANT_KNOWLEDGE_API_TOKEN",
        "database_env": "ORDIVANT_KNOWLEDGE_DATABASE_URL",
        "health_product": "knowledge",
    },
    "code": {
        "backend": ROOT / "products" / "code" / "backend",
        "module": "ordivant_code",
        "data_env": "ORDIVANT_CODE_DATA_DIR",
        "api_env": "ORDIVANT_CODE_API_URL",
        "token_env": "ORDIVANT_CODE_API_TOKEN",
        "database_env": "ORDIVANT_CODE_DATABASE_URL",
        "health_product": "code",
    },
}
MCP_CLIENT = r'''
import asyncio
import json
import os
import sys
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

async def main():
    _, _sentinel, module, tool_name, tool_args_json, required_json, marker = sys.argv
    stage = "initialize"
    try:
        parameters = StdioServerParameters(
            command=sys.executable,
            args=["-m", module + ".mcp_server"],
            env=os.environ.copy(),
            cwd=os.getcwd(),
        )
        async with stdio_client(parameters) as (reader, writer):
            async with ClientSession(reader, writer) as session:
                await session.initialize()
                stage = "list_tools"
                names = sorted(tool.name for tool in (await session.list_tools()).tools)
                required = json.loads(required_json)
                if not set(required).issubset(names):
                    raise RuntimeError("required MCP tool missing")
                stage = "tool_call"
                result = await session.call_tool(tool_name, json.loads(tool_args_json))
                if result.isError:
                    raise RuntimeError("MCP readonly tool returned an error")
                serialized = result.model_dump_json()
                if marker not in serialized:
                    raise RuntimeError("MCP readonly result omitted the requested resource")
                stage = "resource_templates"
                resources = await session.list_resource_templates()
                if not resources.resourceTemplates:
                    raise RuntimeError("MCP server did not expose a resource template")
                print(json.dumps({
                    "tool_count": len(names),
                    "tool_names": names,
                    "readonly_tool": tool_name,
                    "roundtrip": "passed",
                    "resource_templates": len(resources.resourceTemplates),
                }))
    except Exception as error:
        print(json.dumps({"roundtrip": "failed", "stage": stage, "error_type": type(error).__name__}))
        return 1
    return 0

sys.exit(asyncio.run(main()))
'''


class SmokeFailure(Exception):
    def __init__(self, product: str, stage: str, code: str, *, http_status: int | None = None):
        self.product = product
        self.stage = stage
        self.code = code
        self.http_status = http_status
        super().__init__(code)


def python_for(product: str) -> Path:
    backend = PRODUCTS[product]["backend"]
    relative = Path(".venv") / (Path("Scripts/python.exe") if os.name == "nt" else Path("bin/python"))
    return backend / relative


def unused_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def product_environment(product: str, data_dir: Path) -> dict[str, str]:
    config = PRODUCTS[product]
    environment = os.environ.copy()
    if product == "code":
        for name in list(environment):
            upper = name.upper()
            if upper.startswith("ORDIVANT_CODE_GITEA_") or upper == "ORDIVANT_CODE_WEBHOOK_SECRET":
                environment.pop(name, None)
    environment.pop(config["database_env"], None)
    environment.pop(config["database_env"] + "_FILE", None)
    environment.pop(config["api_env"], None)
    environment.pop(config["token_env"], None)
    environment[config["data_env"]] = str(data_dir)
    environment["ORDIVANT_MODE"] = "development"
    environment["PYTHONUNBUFFERED"] = "1"
    environment["PYTHONUTF8"] = "1"
    return environment


def request_json(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    token: str | None = None,
    body: dict[str, Any] | None = None,
    idempotency_key: str | None = None,
) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(base_url + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = response.read()
            parsed = json.loads(payload) if payload else None
            return response.status, parsed
    except urllib.error.HTTPError as error:
        try:
            payload = error.read()
            parsed = json.loads(payload) if payload else None
        except (OSError, json.JSONDecodeError):
            parsed = None
        return error.code, parsed
    except (OSError, urllib.error.URLError, TimeoutError) as error:
        raise RuntimeError("api_unreachable") from error


def require(condition: bool, product: str, stage: str, code: str, *, status: int | None = None) -> None:
    if not condition:
        raise SmokeFailure(product, stage, code, http_status=status)


def read_bootstrap(product: str, data_dir: Path) -> dict[str, str]:
    try:
        value = json.loads((data_dir / "bootstrap.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise SmokeFailure(product, "bootstrap", "bootstrap_unavailable") from error
    if not isinstance(value, dict):
        raise SmokeFailure(product, "bootstrap", "bootstrap_invalid")
    return value


def run_seed(product: str, environment: dict[str, str]) -> None:
    try:
        result = subprocess.run(
            [str(python_for(product)), "-m", PRODUCTS[product]["module"] + ".seed"],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=120,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        raise SmokeFailure(product, "seed", "seed_timeout") from error
    if result.returncode != 0:
        raise SmokeFailure(product, "seed", "seed_failed")


def start_server(product: str, port: int, environment: dict[str, str]) -> subprocess.Popen[str]:
    process = subprocess.Popen(
        [
            str(python_for(product)),
            "-m",
            "uvicorn",
            PRODUCTS[product]["module"] + ".main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--no-access-log",
        ],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        start_new_session=os.name != "nt",
    )
    deadline = time.monotonic() + 45
    base_url = f"http://127.0.0.1:{port}"
    try:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise SmokeFailure(product, "startup", "server_exited_early")
            try:
                status, payload = request_json(base_url, "/api/health")
                if status == 200 and isinstance(payload, dict):
                    return process
            except RuntimeError:
                pass
            time.sleep(0.2)
        raise SmokeFailure(product, "startup", "health_timeout")
    except BaseException:
        stop_owned_process(process)
        raise


def stop_owned_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        process.communicate(timeout=2)
        return
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            process.kill()
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        process.communicate(timeout=8)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            process.kill()
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.communicate(timeout=5)


def mcp_roundtrip(
    product: str,
    environment: dict[str, str],
    *,
    port: int,
    token: str,
    tool: str,
    tool_args: dict[str, object],
    required_tools: list[str],
    marker: str,
) -> dict[str, Any]:
    config = PRODUCTS[product]
    client_environment = dict(environment)
    client_environment[config["api_env"]] = f"http://127.0.0.1:{port}"
    client_environment[config["token_env"]] = token
    command = [
        str(python_for(product)),
        "-c",
        MCP_CLIENT,
        "mcp-client",
        config["module"],
        tool,
        json.dumps(tool_args, ensure_ascii=False),
        json.dumps(required_tools),
        marker,
    ]
    process = subprocess.Popen(
        command,
        cwd=ROOT,
        env=client_environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        start_new_session=os.name != "nt",
    )
    try:
        stdout, _stderr = process.communicate(timeout=60)
    except subprocess.TimeoutExpired as error:
        stop_owned_process(process)
        raise SmokeFailure(product, "mcp", "mcp_timeout") from error
    try:
        result = json.loads(stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError) as error:
        if process.returncode != 0:
            raise SmokeFailure(product, "mcp", "mcp_roundtrip_failed") from error
        raise SmokeFailure(product, "mcp", "mcp_result_invalid") from error
    if process.returncode != 0:
        stage = str(result.get("stage", "client")) if isinstance(result, dict) else "client"
        error_type = str(result.get("error_type", "error")) if isinstance(result, dict) else "error"
        raise SmokeFailure(product, "mcp", f"mcp_{stage}_{error_type.lower()}")
    if not isinstance(result, dict) or result.get("roundtrip") != "passed":
        raise SmokeFailure(product, "mcp", "mcp_roundtrip_failed")
    return result


def smoke_knowledge(data_dir: Path, port: int) -> dict[str, Any]:
    product = "knowledge"
    environment = product_environment(product, data_dir)
    run_seed(product, environment)
    bootstrap = read_bootstrap(product, data_dir)
    require(isinstance(bootstrap.get("writer_token"), str), product, "bootstrap", "writer_token_missing")
    environment[PRODUCTS[product]["api_env"]] = f"http://127.0.0.1:{port}"
    process = start_server(product, port, environment)
    base_url = f"http://127.0.0.1:{port}"
    try:
        health_status, health = request_json(base_url, "/api/health")
        require(
            health_status == 200 and health.get("product") == "knowledge" and health.get("status") == "ok",
            product,
            "health",
            "knowledge_health_failed",
            status=health_status,
        )
        writer_token = bootstrap["writer_token"]
        space_id = bootstrap["primary_scope_id"]
        marker = "standalone-" + uuid.uuid4().hex[:12]
        body = {
            "space_id": space_id,
            "title": f"Standalone Knowledge {marker}",
            "summary": "Independent product smoke evidence.",
            "body": f"Exact immutable v1 body for {marker}.",
            "tags": ["standalone", "validation"],
            "change_summary": "Create a standalone validation document.",
        }
        status, context = request_json(
            base_url,
            "/api/documents",
            method="POST",
            token=writer_token,
            body=body,
            idempotency_key="standalone-create-" + marker,
        )
        require(status == 201 and isinstance(context, dict), product, "create_document", "document_create_failed", status=status)
        document_id = context.get("document", {}).get("id")
        version = context.get("version", {})
        require(
            isinstance(document_id, str)
            and version.get("version") == 1
            and version.get("body") == body["body"]
            and version.get("uri", "").endswith(f"/documents/{document_id}/versions/1"),
            product,
            "create_document",
            "version_one_invalid",
        )

        exact_status, exact = request_json(
            base_url,
            f"/api/documents/{document_id}/versions/1",
            token=writer_token,
        )
        require(
            exact_status == 200 and exact.get("body") == body["body"] and exact.get("content_sha256") == version.get("content_sha256"),
            product,
            "exact_version",
            "exact_version_failed",
            status=exact_status,
        )
        search_status, search = request_json(
            base_url,
            "/api/documents?q=" + urllib.parse.quote(marker),
            token=writer_token,
        )
        match = next((item for item in search if item.get("id") == document_id), None) if isinstance(search, list) else None
        require(
            search_status == 200
            and match is not None
            and match.get("version") == 1
            and marker in match.get("snippet", "")
            and match.get("uri") == version.get("uri"),
            product,
            "text_search",
            "search_citation_failed",
            status=search_status,
        )
        mcp = mcp_roundtrip(
            product,
            environment,
            port=port,
            token=writer_token,
            tool="get_document_context",
            tool_args={"document_id": document_id},
            required_tools=["list_spaces", "get_document_context", "get_document_version"],
            marker=document_id,
        )
        return {
            "status": "passed",
            "port": port,
            "data_dir": str(data_dir.relative_to(ROOT)),
            "api": {
                "health": "passed",
                "writer_create": "passed",
                "exact_version": 1,
                "search_citation": match["uri"],
            },
            "mcp": mcp,
        }
    finally:
        stop_owned_process(process)


def smoke_code(data_dir: Path, port: int) -> dict[str, Any]:
    product = "code"
    environment = product_environment(product, data_dir)
    run_seed(product, environment)
    bootstrap = read_bootstrap(product, data_dir)
    require(isinstance(bootstrap.get("manager_token"), str), product, "bootstrap", "manager_token_missing")
    environment[PRODUCTS[product]["api_env"]] = f"http://127.0.0.1:{port}"
    process = start_server(product, port, environment)
    base_url = f"http://127.0.0.1:{port}"
    try:
        health_status, health = request_json(base_url, "/api/health")
        require(
            health_status == 200
            and health.get("product") == "code"
            and health.get("status") == "ok"
            and health.get("gitea_configured") is False,
            product,
            "health",
            "code_health_or_gitea_config_failed",
            status=health_status,
        )
        manager_token = bootstrap["manager_token"]
        projects_status, projects = request_json(base_url, "/api/projects", token=manager_token)
        require(projects_status == 200 and isinstance(projects, list), product, "project_list", "project_list_failed", status=projects_status)
        project = next((item for item in projects if item.get("key") == "code-demo"), None)
        require(project is not None, product, "project_list", "seeded_code_project_missing")
        project_id = project.get("id")
        project_status, project_detail = request_json(base_url, f"/api/projects/{project_id}", token=manager_token)
        require(
            project_status == 200 and project_detail.get("id") == project_id,
            product,
            "project_read",
            "project_read_failed",
            status=project_status,
        )
        repository_status, repository_result = request_json(
            base_url,
            "/api/repositories",
            method="POST",
            token=manager_token,
            idempotency_key="standalone-code-repo-" + uuid.uuid4().hex,
            body={
                "project_id": project_id,
                "name": "standalone-smoke-" + uuid.uuid4().hex[:10],
                "description": "Expected unavailable until Gitea is configured.",
                "private": True,
            },
        )
        error = repository_result.get("detail", {}) if isinstance(repository_result, dict) else {}
        require(
            repository_status == 503 and isinstance(error, dict) and error.get("code") == "gitea_not_configured",
            product,
            "unconfigured_repository",
            "expected_gitea_unconfigured_503",
            status=repository_status,
        )
        mcp = mcp_roundtrip(
            product,
            environment,
            port=port,
            token=manager_token,
            tool="list_code_projects",
            tool_args={},
            required_tools=["list_code_projects", "list_repositories", "create_repository"],
            marker=project_id,
        )
        return {
            "status": "passed",
            "port": port,
            "data_dir": str(data_dir.relative_to(ROOT)),
            "api": {
                "health": "passed",
                "gitea_configured": False,
                "manager_project_read": "passed",
                "repository_create_status": repository_status,
                "repository_create_code": error.get("code"),
            },
            "mcp": mcp,
        }
    finally:
        stop_owned_process(process)


def run_product(product: str) -> dict[str, Any]:
    python = python_for(product)
    if not python.is_file():
        raise SmokeFailure(product, "prerequisite", "product_venv_python_missing")
    VALIDATION_ROOT.mkdir(parents=True, exist_ok=True)
    data_dir = VALIDATION_ROOT / f"standalone-{product}-{uuid.uuid4().hex[:12]}"
    port = unused_loopback_port()
    if product == "knowledge":
        return smoke_knowledge(data_dir, port)
    return smoke_code(data_dir, port)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--product", choices=("knowledge", "code", "all"), default="all")
    arguments = parser.parse_args()
    selected = ["knowledge", "code"] if arguments.product == "all" else [arguments.product]
    result: dict[str, Any] = {
        "status": "passed",
        "requested_product": arguments.product,
        "products_started_sequentially": selected,
        "work_started": False,
        "runtime_started": False,
        "peer_services_started_concurrently": False,
        "products": {},
    }
    try:
        for product in selected:
            result["products"][product] = run_product(product)
    except SmokeFailure as error:
        result["status"] = "failed"
        result["failure"] = {
            "product": error.product,
            "stage": error.stage,
            "code": error.code,
        }
        if error.http_status is not None:
            result["failure"]["http_status"] = error.http_status
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1
    except Exception:
        result["status"] = "failed"
        result["failure"] = {"product": selected[-1], "stage": "runner", "code": "unexpected_runner_error"}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
