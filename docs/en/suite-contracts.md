# Ordivant Suite contract — revised 2026-10-06

User decisions from the freshly read planning chat: Work, Knowledge and Code are independent products in one monorepo. Each can be deployed alone, owns its database and exposes API + MCP. Code is optional, uses Gitea open-source as an independent Git service. Work must run without Code and accept references to an enterprise's existing version control. Pi Durable belongs to Work.

## Code ownership and deploy boundaries

- `backend/`: Ordivant Work FastAPI/SQLAlchemy/MCP (existing code retained).
- `runtime/`: Work's Pi Durable runtime (existing code retained).
- `products/knowledge/backend/`: independent uv project, Python package `ordivant_knowledge`, own SQLAlchemy engine/models/auth/seed and MCP.
- `products/code/backend/`: independent uv project, Python package `ordivant_code`, own SQLAlchemy engine/models/auth/seed and MCP; Gitea adapter via HTTP API/webhooks only.
- `frontend/`: shared React source; product modules and separately buildable Work/Knowledge/Code artifacts. Shared visual components are allowed, shared private business state is not.
- `scripts/`, root config and `docs/`: PM. No worker edits outside assigned modules without PM approval.

Do not import another product's ORM, sessions, business package or database. Public identifiers, HTTP APIs and explicit references connect products. An unavailable Code or Knowledge service cannot prevent Work startup.

## Shared public conventions

All APIs use `/api`, JSON resource objects or arrays, ISO-8601 UTC timestamps and the domain error shape in `docs/contracts.md`. Each product has its own bearer credentials and enforces its own scopes. `POST /api/auth/local-session` is only loopback + explicit development; `GET /api/me` exposes actor metadata. Tokens are hashed at rest; no bearer credentials in API lists, audit, caches or UI bundles.

Idempotency-Key is scoped to actual route + current actor and request body. Different body conflicts. Cached replies recheck present authorization. Business state and audit/idempotency records commit atomically. PostgreSQL URLs are supported with psycopg; SQLite is quick-start mode. On-write SQLite serialization and PostgreSQL row locking protect version/review/concurrency transitions.

Development seed is explicit and repeatable; create `bootstrap.json` within each product's own data directory. Shape `{manager_token,writer_token,reader_token,manager_id,writer_id,reader_id,organization_id,primary_scope_id,isolated_scope_id}`; these are local generated credentials. Manager owns both seed scopes; writer and reader see primary scope only. Principal `{id,name,kind,role,organization_id,scope_ids:string[]}`. A shared enterprise issuer/subject can later map identities across products; product authorization still remains independent.

No human password handling or credential prompts. Gitea test credentials are service-generated for owned local test instances only; user-supplied passwords must use the user's tmux rule.

## Knowledge API (port 8010)

Environment: `ORDIVANT_KNOWLEDGE_DATA_DIR` defaults repo `/.data/knowledge`; `ORDIVANT_KNOWLEDGE_DATABASE_URL` optional; `ORDIVANT_MODE` strict development/production. Entrypoints `python -m ordivant_knowledge.seed`, `uvicorn ordivant_knowledge.main:app` and `python -m ordivant_knowledge.mcp_server`.

`GET /api/health` -> `{status:"ok",product:"knowledge",database,mode}`.

`Space`: `{id,key,name,description,organization_id,created_at}`.
`Document`: `{id,space_id,title,summary,tags:string[],current_version:number,created_at,updated_at}`.
`Version`: `{id,document_id,version:number,title,body,change_summary,author_id,content_sha256,source_refs:Reference[],created_at,uri}`. A persisted version is immutable. `DocumentContext`: `{document,version,history:Version[],decisions:Decision[]}`.
`Reference`: `{product:"work"|"knowledge"|"code"|"external",kind:"task"|"document_version"|"pull_request"|"test_report"|"url",uri,title}`. A link is a reference, not authorization to access its destination.
`Decision`: `{id,space_id,document_id:string|null,title,body,source_refs:Reference[],actor_id,created_at}`.

- `GET/POST /api/spaces`; create `{key,name,description?}` manager only.
- `GET /api/spaces/{id}` scope enforced.
- `GET /api/documents?space_id=&q=&tag=` scoped metadata/search. Search matches title/body; results identify the version and citation URI (return metadata with `snippet?`, `uri?`, `version?` extras allowed).
- `POST /api/documents` `{space_id,title,summary?,body,tags?:[],change_summary?,source_refs?:[]}` creates document + immutable version 1 atomically and returns DocumentContext. Manager/writer only within scope.
- `GET /api/documents/{id}` -> DocumentContext for latest version.
- `GET /api/documents/{id}/versions` -> Version[]; `GET /api/documents/{id}/versions/{n}` -> exact Version.
- `POST /api/documents/{id}/versions` `{expected_version,title?,body,change_summary,source_refs?:[]}` compare-and-swap current version and returns the newly created Version; stale expected_version is 409. Body must be nonblank. Old versions must remain identical after updates.
- `GET/POST /api/decisions?space_id=`; create `{space_id,document_id?,title,body,source_refs?:[]}`. Document must be in same authorized space.
- `GET /api/events?space_id=` scoped audit list.

Canonical citations: `ordivant://knowledge/spaces/{space_id}/documents/{document_id}/versions/{n}`. No fake embeddings/RAG: use actual persisted text search for this pilot and label it as text search.

MCP env `ORDIVANT_KNOWLEDGE_API_URL`, `ORDIVANT_KNOWLEDGE_API_TOKEN`. Official SDK stdio bridge tools: `list_spaces`, `search_knowledge`, `create_document`, `get_document_context`, `get_document_version`, `publish_document_version`, `record_decision`, `list_decisions`; optional mutation request_id maps to Idempotency-Key. Expose exact-version resources and a context citation prompt. Tools never accept caller-supplied actor identity.

Knowledge acceptance: writer creates v1; concurrent v2 publishing yields one success and one 409; v1 body/hash unchanged; duplicate publish does not create v3; text search returns current content + exact citation; reader cannot write; isolated space denied; task/PR provenance preserved; data persist across process restart; actual SDK round trip.

## Code API (port 8020)

Environment: `ORDIVANT_CODE_DATA_DIR` defaults repo `/.data/code`; `ORDIVANT_CODE_DATABASE_URL` optional; `ORDIVANT_CODE_GITEA_URL`, `ORDIVANT_CODE_GITEA_TOKEN`, `ORDIVANT_CODE_WEBHOOK_SECRET` or ignored JSON `ORDIVANT_CODE_GITEA_CONFIG` containing `{url,token,webhook_secret}`. Entrypoints `python -m ordivant_code.seed`, `uvicorn ordivant_code.main:app`, `python -m ordivant_code.mcp_server`.

`GET /api/health` -> `{status:"ok",product:"code",database,mode,gitea_configured:boolean}`. No network call or credential in health. When Gitea is unconfigured, read existing metadata works; operations requiring it return 503 `gitea_not_configured`.

`CodeProject`: `{id,key,name,description,organization_id,created_at}`.
`Repository`: `{id,project_id,provider:"gitea",owner,name,default_branch,web_url,clone_url,created_at}`.
`PullRequest`: `{id,repository_id,number,title,body,state:"open"|"closed",head,base,web_url,head_sha,source_refs:Reference[],created_at,updated_at}`. Gitea is the source of Git/PR state. Platform stores scoped references and receipts, not a second implementation of Git.
`Check`: `{id,repository_id,commit_sha,context,state:"pending"|"success"|"failure"|"error",description,target_url:string|null,source:"agent_reported"|"gitea_webhook",actor_id,created_at}`. Agent reports are labeled as such; don't imply a CI runner executed tests.

- `GET/POST /api/projects` and `GET /api/projects/{id}` scope enforced, manager create.
- `GET /api/repositories?project_id=` -> locally scoped repository list.
- `POST /api/repositories` `{project_id,name,description?,private?:true}` creates repo on configured Gitea service account with auto_init README and main branch, then stores binding. Must reconcile response-loss retry by fetching the deterministic owner/name; reject attempts to adopt unrecorded existing repositories unless an explicit manager binding operation verifies authority. Global account privilege cannot expand Code project permission.
- `POST /api/repositories/{id}/branches` `{name,from_branch?:"main"}` actual Gitea branch. Validate branch/path input and manager/writer scope. Idempotent same request; response `{name,commit_sha}`.
- `POST /api/repositories/{id}/files` `{branch,path,content,commit_message,expected_sha?:string}` actual Gitea Contents API, content UTF-8 -> base64; create/update guarded by existing sha. Returns `{path,branch,commit_sha,file_sha}`. For response-loss retries reconcile the intended content/commit or maintain durable intent; never silently create duplicate commits under the same Idempotency-Key.
- `GET /api/repositories/{id}/pulls` -> PullRequest[] (refresh via Gitea when configured); `POST /api/repositories/{id}/pulls` `{head,base?:"main",title,body?,source_refs?:[]}` actual Gitea PR, returns scoped PullRequest. Reconcile duplicate/response-loss retries using stable head/base before creation.
- `GET /api/repositories/{id}/pulls/{number}` -> PR plus `checks:Check[]` and source_refs.
- `POST /api/repositories/{id}/checks` `{commit_sha,context,state,description?,target_url?}` reports actual Gitea commit status and persists a clearly agent_reported receipt. Reader cannot write, references cannot widen access.
- `POST /api/webhooks/gitea` raw JSON, validate `X-Gitea-Signature` HMAC-SHA256 against raw bytes and configured secret before JSON processing; dedupe `X-Gitea-Delivery` and reject replay with changed body. Only update bound repositories matching full owner/name. Trusted webhook may synchronize push/pull request receipt metadata; never approve Work tasks or merge PRs.
- `GET /api/events?project_id=` scoped audit.

No merge/delete operations in this pilot. Write APIs operate only on explicitly selected scoped bindings. A service account's Gitea token is never returned to clients. Gitea's actual permissions are still enforced by its API; one local pilot account is not claimed as final enterprise per-agent ACL synchronization.

MCP env `ORDIVANT_CODE_API_URL`, `ORDIVANT_CODE_API_TOKEN`. Official SDK stdio bridge tools: `list_code_projects`, `list_repositories`, `create_repository`, `create_branch`, `commit_file`, `create_pull_request`, `get_pull_request`, `report_check`, `get_code_events`; mutation request_id -> Idempotency-Key. Expose PR context resources.

Code acceptance: owned local Gitea open-source instance; create private repo, branch, real file commit, real PR, real status, retrieve same PR; duplicate calls don't create extra objects/commits; forged webhook rejected and signed delivery dedupes; reader/isolated project denied; missing Gitea does not prevent startup; no raw upstream token/secret in responses/audit/cache; actual SDK round trip. CI receipts must not be described as an actual CI test run.

## Frontend modules and independence

Add a clear Work/Knowledge/Code product switcher; Work brand says Ordivant Work. Preserve the completed Work surface. `/`, `/work` -> Work; `/knowledge` -> knowledge workspace; `/code` -> code workspace. Each product initializes only its own session/API and works if peers are down. Vite proxies Work `/api`, Knowledge `/knowledge-api` -> port8010 `/api`, Code `/code-api` -> port8020 `/api` (configurable targets). Separate build modes `work`, `knowledge`, `code` can emit distinct artifacts, with standalone mode choosing its product at `/` and configurable own API prefix.

Knowledge surface: spaces selector, search/list documents, exact version chooser, readable safe Markdown/body, create/publish with expected version and conflict error, immutable version history, decisions/provenance. Code surface: projects/repositories, clearly configured/unconfigured state, create repository/branch/commit/PR, retrieve PR/checks, status reporting explicitly self-reported. Independent local-session and manual token fallback. No bundled service credentials. Strong restrained common design, responsive, real API errors; product UI does not mention internal implementation details unless useful to operate.

## Integrated acceptance and scope

Knowledge v1 -> Work task with exact-version artifact/ref -> A delegates B -> Code creates owned local Git branch/commit/PR with Work + Knowledge references -> test evidence/status recorded -> independent reviewer accepts Work evidence -> Knowledge publishes v2 referencing task/PR. Every product exposes its own MCP. Separately test Work with both peers stopped and a reference to existing GitHub/GitLab/generic VCS; it must still complete its normal workflow. Live enterprise VCS credentials/SSO and paid models remain separately configured gates, not invented test results.
