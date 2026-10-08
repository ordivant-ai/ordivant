from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import socket
from urllib.parse import urlsplit

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from sqlalchemy import select
from sqlalchemy.orm import Session

from .errors import DomainError, bad_request, forbidden, not_found
from .model_settings import _decrypt_secret, _encrypt_secret, require_model_admin
from .models import AuditEvent, Project, RunToolConnectionSnapshot, ToolConnection
from .security import new_id, now_utc, principal_projects


def _hosts(env_name: str) -> set[str]:
    return {entry.strip().lower().rstrip(".") for entry in os.getenv(env_name, "").split(",") if entry.strip()}


def _is_private_address(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    return not ip.is_global


def _redact_probe_value(value, secret: str):
    if isinstance(value, str):
        return value.replace(secret, "[redacted]") if secret else value
    if isinstance(value, list):
        return [_redact_probe_value(item, secret) for item in value[:100]]
    if isinstance(value, dict):
        return {str(key)[:100]: _redact_probe_value(item, secret) for key, item in list(value.items())[:100]}
    return value


class _NoRedirectClient(httpx.AsyncClient):
    async def send(self, request, *, stream: bool = False, auth=None, follow_redirects: bool = False):
        response = await super().send(request, stream=stream, auth=auth, follow_redirects=False)
        if response.is_redirect:
            await response.aclose()
            raise DomainError(502, "tool_redirect_rejected", "MCP endpoint redirects are disabled")
        return response


def validate_endpoint(endpoint: str) -> str:
    try:
        parsed = urlsplit(endpoint)
        host = (parsed.hostname or "").lower().rstrip(".")
        port = parsed.port
    except ValueError as exc:
        raise bad_request("tool_endpoint_invalid", "MCP endpoint URL 或 port 無效") from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not host
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
        or parsed.query
    ):
        raise bad_request("tool_endpoint_invalid", "MCP endpoint 必須是沒有帳密或 query 的 HTTP(S) URL")
    if host not in _hosts("ORDIVANT_TOOL_ALLOWED_HOSTS"):
        raise forbidden("MCP endpoint host 不在 operator allowlist")
    if parsed.scheme == "http" and host not in _hosts("ORDIVANT_TOOL_HTTP_HOSTS"):
        raise forbidden("HTTP MCP endpoint host 不在 operator HTTP allowlist")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)}
    except OSError as exc:
        raise bad_request("tool_endpoint_unreachable", "MCP endpoint host 無法解析") from exc
    if not addresses:
        raise bad_request("tool_endpoint_unreachable", "MCP endpoint host 無法解析")
    if any(_is_private_address(address) for address in addresses) and host not in _hosts("ORDIVANT_TOOL_PRIVATE_HOSTS"):
        raise forbidden("MCP endpoint 的 private address host 不在 operator private allowlist")
    return host


def connection_json(row: ToolConnection) -> dict:
    return {
        "id": row.id,
        "project_id": row.project_id,
        "name": row.name,
        "endpoint": row.endpoint,
        "enabled": row.enabled,
        "allowed_tools": json.loads(row.allowed_tools_json),
        "key_configured": bool(row.auth_token_ciphertext),
        "created_at": row.created_at.isoformat().replace("+00:00", "Z"),
        "updated_at": row.updated_at.isoformat().replace("+00:00", "Z"),
    }


def validate_connection_for_projects(
    session: Session,
    connection_id: str,
    project_ids: set[str],
    *,
    require_enabled: bool,
) -> ToolConnection:
    row = session.get(ToolConnection, connection_id)
    if row is None or row.project_id not in project_ids or (require_enabled and not row.enabled):
        raise bad_request("tool_connection_scope", "Tool connection 不在可用的 project scope 或已停用")
    validate_endpoint(row.endpoint)
    return row


def list_tool_connections(session: Session, actor, project_id: str | None = None) -> list[dict]:
    project_ids = principal_projects(session, actor.id)
    if project_id:
        from .service import require_project

        require_project(session, actor, project_id)
        project_ids = [project_id]
    if not project_ids:
        return []
    rows = session.scalars(
        select(ToolConnection)
        .where(ToolConnection.project_id.in_(project_ids))
        .order_by(ToolConnection.project_id, ToolConnection.name, ToolConnection.id)
    )
    return [connection_json(row) for row in rows]


def create_tool_connection(session: Session, actor, value: dict, project_id: str | None) -> dict:
    require_model_admin(session, actor)
    from .service import require_project

    selected_project = value.get("project_id") or project_id
    if not selected_project:
        raise bad_request("project_required", "建立 Tool connection 必須指定 project_id")
    require_project(session, actor, selected_project)
    endpoint = value["endpoint"].strip()
    validate_endpoint(endpoint)
    auth_token = value.get("auth_token")
    if hasattr(auth_token, "get_secret_value"):
        auth_token = auth_token.get_secret_value()
    row = ToolConnection(
        id=new_id(),
        project_id=selected_project,
        name=value["name"],
        endpoint=endpoint,
        enabled=value.get("enabled", True),
        allowed_tools_json=json.dumps(list(dict.fromkeys(value.get("allowed_tools", []))), ensure_ascii=False),
        auth_token_ciphertext=None,
        created_at=now_utc(),
        updated_at=now_utc(),
    )
    if auth_token:
        row.auth_token_ciphertext = _encrypt_secret(auth_token, actor.organization_id, row.id)
    session.add(row)
    session.add(
        AuditEvent(
            id=new_id(), project_id=selected_project, actor_id=actor.id, action="tool_connection.created",
            entity_type="tool_connection", entity_id=row.id,
            data_json=json.dumps({"enabled": row.enabled, "allowed_tools": json.loads(row.allowed_tools_json)}, separators=(",", ":")),
            created_at=now_utc(),
        )
    )
    session.flush()
    return connection_json(row)


def patch_tool_connection(session: Session, actor, connection_id: str, patch: dict) -> dict:
    require_model_admin(session, actor)
    row = session.get(ToolConnection, connection_id)
    if row is None:
        raise not_found("找不到 Tool connection")
    from .service import require_project

    project = require_project(session, actor, row.project_id)
    values = {key: value for key, value in patch.items() if key in {"name", "endpoint", "enabled", "allowed_tools", "auth_token"}}
    endpoint = values.get("endpoint", row.endpoint)
    endpoint = endpoint.strip()
    validate_endpoint(endpoint)
    auth_token = values.get("auth_token")
    if hasattr(auth_token, "get_secret_value"):
        auth_token = auth_token.get_secret_value()
    if endpoint != row.endpoint and row.auth_token_ciphertext and not auth_token:
        raise bad_request("tool_auth_required", "變更 endpoint 時必須重新提供 auth_token")
    if "name" in values:
        row.name = values["name"]
    if "endpoint" in values:
        row.endpoint = endpoint
    if "enabled" in values:
        row.enabled = values["enabled"]
    if "allowed_tools" in values and values["allowed_tools"] is not None:
        row.allowed_tools_json = json.dumps(list(dict.fromkeys(values["allowed_tools"])), ensure_ascii=False)
    if auth_token:
        row.auth_token_ciphertext = _encrypt_secret(auth_token, project.organization_id, row.id)
    row.updated_at = now_utc()
    fields = sorted(key for key in values if key != "auth_token")
    if auth_token:
        fields.append("auth_token")
    session.add(
        AuditEvent(
            id=new_id(), project_id=row.project_id, actor_id=actor.id, action="tool_connection.updated",
            entity_type="tool_connection", entity_id=row.id,
            data_json=json.dumps({"fields": fields}, separators=(",", ":")), created_at=now_utc(),
        )
    )
    session.flush()
    return connection_json(row)


def snapshot_tool_connections(session: Session, run_id: str, project_id: str, connection_ids: list[str]) -> None:
    project = session.get(Project, project_id)
    if project is None:
        raise not_found("找不到 project")
    for connection_id in connection_ids:
        row = validate_connection_for_projects(session, connection_id, {project_id}, require_enabled=True)
        session.add(
            RunToolConnectionSnapshot(
                id=new_id(), run_id=run_id, connection_id=row.id, project_id=project_id, name=row.name,
                endpoint=row.endpoint, allowed_tools_json=row.allowed_tools_json,
                auth_token_ciphertext=row.auth_token_ciphertext,
            )
        )


def handoff_tool_connections(session: Session, run_id: str, organization_id: str, project_id: str) -> list[dict]:
    rows = session.scalars(
        select(RunToolConnectionSnapshot).where(RunToolConnectionSnapshot.run_id == run_id).order_by(RunToolConnectionSnapshot.connection_id)
    )
    result = []
    for row in rows:
        if row.project_id != project_id:
            raise DomainError(409, "tool_connection_snapshot_invalid", "Dispatch tool connection project scope changed")
        validate_endpoint(row.endpoint)
        token = _decrypt_secret(row.auth_token_ciphertext, organization_id, row.connection_id) if row.auth_token_ciphertext else None
        result.append({
            "id": row.connection_id,
            "name": row.name,
            "endpoint": row.endpoint,
            "allowed_tools": json.loads(row.allowed_tools_json),
            "auth_token": token,
        })
    return result


async def test_tool_connection(session: Session, actor, connection_id: str) -> dict:
    require_model_admin(session, actor)
    row = session.get(ToolConnection, connection_id)
    if row is None:
        raise not_found("找不到 Tool connection")
    from .service import require_project

    project = require_project(session, actor, row.project_id)
    validate_endpoint(row.endpoint)
    headers = {}
    secret = None
    if row.auth_token_ciphertext:
        secret = _decrypt_secret(row.auth_token_ciphertext, project.organization_id, row.id)
        headers["Authorization"] = "Bearer " + secret
    try:
        def client_factory(*, headers=None, timeout=None, auth=None):
            return _NoRedirectClient(headers=headers, timeout=timeout, auth=auth)

        async with streamablehttp_client(
            row.endpoint,
            headers=headers,
            timeout=10,
            sse_read_timeout=10,
            httpx_client_factory=client_factory,
        ) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as client:
                await asyncio.wait_for(client.initialize(), timeout=10)
                result = await asyncio.wait_for(client.list_tools(), timeout=10)
        tools = []
        for item in result.tools[:100]:
            schema = getattr(item, "inputSchema", {}) or {}
            encoded_schema = json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
            if len(encoded_schema) > 16000:
                schema = {"type": "object", "properties": {}}
            tools.append({
                "name": _redact_probe_value(str(item.name)[:200], secret),
                "description": _redact_probe_value((item.description or "")[:2000], secret),
                "input_schema": _redact_probe_value(schema, secret),
            })
        return {"ok": True, "tools": tools}
    except DomainError:
        raise
    except Exception as exc:
        raise DomainError(502, "tool_probe_failed", "MCP tools/list request failed") from exc
