# Ordivant Knowledge

Knowledge is an independently runnable product with its own FastAPI service, SQLAlchemy metadata, database URL, bearer-token table, REST API, and MCP stdio bridge. It does not import Work or Code business packages and does not share their databases.

## Local setup

From the repository root:

```powershell
uv sync --project products/knowledge/backend --extra dev
uv run --project products/knowledge/backend python -m ordivant_knowledge.seed
uv run --project products/knowledge/backend uvicorn ordivant_knowledge.main:app --host 127.0.0.1 --port 8010
```

The seed is explicit and repeatable. It writes `.data/knowledge/bootstrap.json` with a manager, writer, reader, organization, primary scope, and isolated scope. The API database stores only SHA-256 token hashes. Keep the bootstrap file local and untracked; do not paste its credentials into logs or client bundles.

The default database is `.data/knowledge/knowledge.sqlite3`, anchored at the repository root. Set `ORDIVANT_KNOWLEDGE_DATA_DIR` to move both the default database and bootstrap file, or set `ORDIVANT_KNOWLEDGE_DATABASE_URL` to use PostgreSQL through `psycopg`. `ORDIVANT_MODE` accepts only `development` or `production`. SQLite quick-start uses WAL, foreign keys, a busy timeout, and serialized write transactions.

`GET /api/health` reports product, database kind, and mode without credentials. The seed's manager/writer/reader tokens are accepted as normal bearer credentials. `GET /api/me` returns the authenticated principal and its current visible scope IDs. `POST /api/auth/local-session` accepts `{}` and issues an ephemeral token for an active human manager in development, from loopback or an explicitly authorized development proxy. Optional `principal_id` or server `ORDIVANT_KNOWLEDGE_LOCAL_PRINCIPAL_ID` selects that manager. The container proxy reads a mounted `ORDIVANT_DEV_PROXY_TOKEN_FILE`; forwarded client addresses never grant access. Production disables this route regardless of proxy headers. `ORDIVANT_KNOWLEDGE_DATABASE_URL_FILE` also supports a mounted database URL secret.

## Knowledge API

All routes use `/api`. Documents begin at version 1 and each publish inserts an immutable version with the SHA-256 of the exact UTF-8 body. Publishing requires `expected_version`; a stale compare-and-swap returns `409 stale_version`. `POST /api/documents` returns a `DocumentContext` (`document`, current `version`, `history`, and linked `decisions`). `POST /api/documents/{id}/versions` returns the newly published `Version`.

Search is persisted text matching over current document titles and bodies. It returns snippets, version numbers, content hashes, and canonical citations in the form `ordivant://knowledge/spaces/{space_id}/documents/{document_id}/versions/{n}`. There is no vector or synthetic RAG fallback. Provenance references are stored as supplied labels and never grant access to Work, Code, or external resources.

Mutating calls may include `Idempotency-Key`. Keys are scoped to the concrete request path and authenticated actor; identical body replays the original status and response, while changed body returns `409 idempotency_conflict`. Authorization is checked before a cached response is considered. Business changes, audit entries, and idempotency records commit in the same transaction.

## MCP

Start with a scoped Knowledge token from `.data/knowledge/bootstrap.json`:

```powershell
$env:ORDIVANT_KNOWLEDGE_API_URL = "http://127.0.0.1:8010"
$env:ORDIVANT_KNOWLEDGE_API_TOKEN = "<scoped Knowledge token>"
uv run --project products/knowledge/backend python -m ordivant_knowledge.mcp_server
```

The official Python SDK stdio server exposes `list_spaces`, `search_knowledge`, `create_document`, `get_document_context`, `get_document_version`, `publish_document_version`, `record_decision`, and `list_decisions`. Optional `request_id` tool inputs are sent as `Idempotency-Key`. It also exposes exact-version citation resources and a context citation prompt. MCP never accepts a caller-supplied actor; the REST service applies the configured token's permissions.

## Verification

```powershell
uv run --project products/knowledge/backend pytest products/knowledge/backend/tests
```

Tests cover concurrent version publication, stale version rejection, immutable prior content and hash, scoped denial, reader write denial, idempotent replay, provenance and audit, deterministic text citations, explicit seed repeatability, and persistence after reopening the independent database.
