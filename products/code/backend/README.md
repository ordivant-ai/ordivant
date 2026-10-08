# Ordivant Code Backend

Independent FastAPI service for Code project scopes, local repository bindings, Gitea repositories, branches, file commits, pull requests, and status receipts. It owns its SQLite/PostgreSQL database and credentials; it does not import Work or Knowledge business state.

## Run

Use Python 3.12 and `uv` from this directory. Keep the uv cache in the repository:

```powershell
$env:UV_CACHE_DIR = "../../../.cache/uv"
uv sync --python 3.12
uv run python -m ordivant_code.seed
uv run uvicorn ordivant_code.main:app --host 127.0.0.1 --port 8020
```

The explicit seed creates clearly labeled DEMO manager, writer, reader, primary and isolated scopes. It writes generated local credentials to the ignored `bootstrap.json` in the Code data directory. The seed command prints only the file path.

By default, data is stored under the monorepo `.data/code/`. Set `ORDIVANT_CODE_DATA_DIR` to an isolated directory for validation. `ORDIVANT_CODE_DATABASE_URL` can override SQLite with a PostgreSQL URL, or `ORDIVANT_CODE_DATABASE_URL_FILE` can point to a mounted secret file containing that URL. `ORDIVANT_MODE` accepts only `development` or `production`; local sessions are disabled in production and limited to loopback development requests unless a development proxy injects `X-Ordivant-Dev-Proxy` matching `ORDIVANT_DEV_PROXY_TOKEN` or `ORDIVANT_DEV_PROXY_TOKEN_FILE`.

## Gitea

Gitea is optional at startup. Without it, the service remains healthy, serves persisted projects/repository/PR metadata, and returns `503 gitea_not_configured` for operations that need upstream state.

Configure `ORDIVANT_CODE_GITEA_URL`, `ORDIVANT_CODE_GITEA_TOKEN`, and `ORDIVANT_CODE_WEBHOOK_SECRET`, or set `ORDIVANT_CODE_GITEA_CONFIG` to an ignored JSON file containing `url`, `token`, and `webhook_secret`. Provider credentials are never included in API responses, audit events, or idempotency responses. API tokens are hashed at rest.

## MCP

The official Python SDK bridge calls the same REST API and uses the configured scoped Code bearer token:

```powershell
$env:ORDIVANT_CODE_API_URL = "http://127.0.0.1:8020"
$env:ORDIVANT_CODE_API_TOKEN = "<scoped Code token>"
uv run python -m ordivant_code.mcp_server
```

Mutations pass `request_id` as `Idempotency-Key`; without one, the bridge generates a unique request id. Agent-reported status receipts are labeled `agent_reported` and do not imply that a CI runner executed tests.

## Tests

```powershell
uv run pytest
```
