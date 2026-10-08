# Ordivant Backend

Ordivant backend is the source of truth for project access, tasks, executions, evidence, reviews, collaboration messages, audit history, idempotency, and runtime dispatch. It uses FastAPI and SQLAlchemy with SQLite for local startup and PostgreSQL through psycopg for hosted pilots. MCP stdio is an official Python SDK bridge to the same REST policies.

## Local Setup

Use Python 3.12 and uv from the repository root. The cache override keeps package files inside the workspace:

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
uv sync --project backend --python 3.12 --extra dev
```

The local seed is explicit and repeatable. It creates `.data/ordivant.db` and `.data/bootstrap.json` under the repository root. The bootstrap file contains development credentials; it is ignored by Git and must not be shared as a public artifact.

```powershell
uv run --project backend python -m ordivant.seed
uv run --project backend uvicorn ordivant.main:app --host 127.0.0.1 --port 8000
```

The seed creates a manager, runtime credential, planner and builder Pi agents, analyst and reviewer agents, an `ORD` demonstration project, and an `ISO` project with narrower agent access. Demo tasks span `ready`, `in_progress` with an expired sample lease, `blocked`, `in_review`, and `done`. Demo records are labeled `DEMO` / `示範` in the project and audit data. Re-running the seed preserves existing task state and reuses valid credentials from the bootstrap file.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ORDIVANT_MODE` | `development` | `development` enables loopback-only local sessions; `production` disables them. Other values stop startup requests with a configuration error. |
| `ORDIVANT_DATABASE_URL` | SQLite database in `.data/ordivant.db` | SQLAlchemy URL. `postgres://` and `postgresql://` are normalized to psycopg. |
| `ORDIVANT_DATA_DIR` | repository `.data` | Directory for the default SQLite file and generated `bootstrap.json`; useful for isolated local runs. |
| `ORDIVANT_LOCAL_PRINCIPAL_ID` | first active manager/admin human | Optional explicit human principal for development local sessions. |
| `ORDIVANT_API_URL` | `http://127.0.0.1:8000` | REST base URL used by the MCP bridge. |
| `ORDIVANT_API_TOKEN` | unset | Scoped agent bearer token for MCP. Required by the bridge and never accepted as a tool argument. |
| `ORDIVANT_TOOL_ALLOWED_HOSTS` | empty | Exact host allowlist for configured outbound MCP Streamable HTTP connections. |
| `ORDIVANT_TOOL_HTTP_HOSTS` | empty | Exact-host opt-in for outbound MCP over HTTP; HTTPS is preferred. |
| `ORDIVANT_TOOL_PRIVATE_HOSTS` | empty | Exact-host opt-in when DNS resolves to loopback, private, or other non-global addresses, in every mode. Private HTTPS still requires valid TLS. |

The browser local-session endpoint is available only in development and only when the TCP peer is a loopback IP. Production deployments must provision scoped tokens through a trusted administrative workflow. Token values are shown once by agent creation and stored as hashes in the business database.

## MCP stdio

Choose one agent token from the ignored bootstrap file in the MCP client's environment. For example, in PowerShell without printing the token:

```powershell
$bootstrap = Get-Content .data/bootstrap.json -Raw | ConvertFrom-Json
$env:ORDIVANT_API_URL = 'http://127.0.0.1:8000'
$env:ORDIVANT_API_TOKEN = $bootstrap.agents.planner.token
uv run --project backend python -m ordivant.mcp_server
```

The stdio bridge provides task, review, agent, and inbox tools plus project/task context resources and work/review prompts. Mutations send `request_id` as `Idempotency-Key`; actor identity always comes from the configured bearer token.

## Runs, Workflows, Tools, And Sandboxes

Dispatch writes the outbox event and its durable Run mirror in the same database transaction. A Run is runtime status and receipt evidence; the business task remains open for independent review. Managers can list runs, read ordered bounded events, request pause/resume/stop, and retry eligible failed or aborted work as a new Run. A stop releases the business execution fence immediately while the runtime delivery owner remains attached until actual abort acknowledgement.

Agent execution settings live in an additive side table and are snapshotted on each dispatch. Immutable Agent template versions and versioned project workflows share those settings. The runtime workflow tick creates eligible scheduled instances and dispatches steps only when dependencies have been accepted and a scoped Pi worker is available. Schedule versions start disabled.

Tool connections use the official Python MCP Streamable HTTP client for a bounded `tools/list` probe. Authentication is write-only in REST, encrypted at rest, and handed only to the fenced runtime owner; it is not included in outbox payloads or idempotency responses. The dispatcher applies the operator host policy on save, probe, and runtime handoff. Sandbox profiles persist bounded policy values for per-run executor handoff; Docker execution and isolation are provided by the separate sandbox service.

The run and automation API contracts are documented in `../docs/execution-contracts.md`. The REST and MCP bridge use the same Python service authorization. Runtime credentials are restricted to delivery, run sync/control polling, and workflow tick operations.

## Data And Backup

For a SQLite backup, stop the API and copy the whole configured data directory, including the database and bootstrap file. Keep the bootstrap file private because it contains valid development credentials. For PostgreSQL, back up the database with the hosting team's `pg_dump` process and store bootstrap credentials separately in the approved secret manager. Restore both the database and its credentials before starting the API.

## Verification

```powershell
uv run --project backend --extra dev pytest -q
```

The tests use isolated temporary SQLite files and do not print or store generated API tokens outside the test process.

## Limits

This pilot backend does not provide OIDC/SSO, external credential provisioning, object storage, or a hosted MCP gateway. Agent-reported costs are labeled `self_reported`; they are not verified paid-model usage. Runtime delivery is persisted in the outbox, while Pi Harness ownership and transcript recovery are supplied by the separate runtime module.
