<span id="knowledge-獨立容器驗收"></span>
<span id="knowledge-独立容器验收"></span>

# Knowledge Standalone Container Acceptance

`scripts/standalone_container_acceptance.py` performs black-box acceptance of a Knowledge-only production Compose project started by `scripts/containers.ps1`. It does not run `up` or `down`, stop other services, or delete volumes. Its only lifecycle operation is to restart the specified project's `knowledge-api`, then wait for the API through the Web proxy.

<span id="啟動與驗收"></span>
<span id="启动与验收"></span>

## Start and acceptance

Run these commands from the repository root in PowerShell:

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
$env:ORDIVANT_WEB_PORT = '8089'
./scripts/containers.ps1 -Action up -Products knowledge -Seed -ProjectName ordivant-knowledge-qa
```

After the helper reports that the project is ready, run:

```powershell
uv run --project backend python scripts/standalone_container_acceptance.py --project-name ordivant-knowledge-qa --web-port 8089
```

The script operates only on the explicitly named project through `docker compose` and requires exactly these containers: `knowledge-api`, `knowledge-db`, `web`, `identity-api`, and `identity-db`. Identity must be healthy, and first-run setup must not have been initialized by the test. The Web origin is fixed to loopback `127.0.0.1`; `--web-port` accepts only a valid TCP port, not an external host.

Acceptance verifies that `/api/health` reports PostgreSQL and production mode, production `local-session` returns `403`, scoped writers and readers can access the primary space, and a writer cannot access the isolated space. It creates a uniquely marked document and checks that a repeated `Idempotency-Key` does not create a duplicate, a reader can access the exact version, full-text search returns a citation to that exact version, and reader writes are denied.

The official MCP Python SDK starts the Knowledge MCP server over stdio inside the `knowledge-api` container. It calls `get_document_version` with the bootstrap writer bearer and verifies that all eight tools are available. Finally, only `knowledge-api` is restarted; the check confirms health returns and the exact document body and hash remain present.

Bootstrap data is captured from `/data/bootstrap.json` in the container into the acceptance process memory through `docker compose exec -T knowledge-api python -c ...`. The MCP writer token is sent to Python inside the container over standard input. Neither value is placed in shell command arguments. The report is written to `.data/validation/standalone-knowledge-<project>-<timestamp>-<id>/report.json` and contains only non-sensitive acceptance results.
