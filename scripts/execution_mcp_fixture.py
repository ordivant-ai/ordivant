"""Synthetic, local-only MCP fixture; never connect it to production projects."""

from __future__ import annotations

import asyncio
import hmac
import json

from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings
from starlette.responses import JSONResponse

FIXTURE_TOKEN = "synthetic-ordivant-execution-mcp"
mcp = FastMCP(
    "Ordivant isolated execution fixture",
    host="0.0.0.0",
    port=8050,
    stateless_http=True,
    json_response=True,
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=["mcp-fixture:*", "127.0.0.1:*", "localhost:*"],
        allowed_origins=["http://mcp-fixture:*", "http://127.0.0.1:*"],
    ),
)


@mcp.tool()
async def synthetic_add(a: int, b: int) -> str:
    """Return a real calculation for synthetic acceptance input."""
    return json.dumps({"sum": a + b, "source": "synthetic_local_mcp_fixture"})


@mcp.tool()
async def synthetic_wait(seconds: int = 2) -> str:
    """Bounded synthetic delay, useful for execution control acceptance."""
    await asyncio.sleep(max(0, min(seconds, 15)))
    return "synthetic wait completed"


@mcp.tool()
async def forbidden_fixture_tool() -> str:
    """Tool intentionally excluded by the project allowlist."""
    return "This tool must not be registered for the acceptance Agent."


class FixtureAuth:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope.get("path") == "/health":
            await JSONResponse({"status": "ok", "fixture": True})(scope, receive, send)
            return
        if scope["type"] == "http":
            headers = dict(scope.get("headers", []))
            supplied = headers.get(b"authorization", b"").decode("utf-8", errors="replace")
            if not hmac.compare_digest(supplied, "Bearer " + FIXTURE_TOKEN):
                await JSONResponse({"error": "unauthorized_fixture"}, status_code=401)(scope, receive, send)
                return
        await self.app(scope, receive, send)


app = FixtureAuth(mcp.streamable_http_app())

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8050, access_log=False)
