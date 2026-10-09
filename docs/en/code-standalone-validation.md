<span id="code-獨立容器驗收"></span>
<span id="code-独立容器验收"></span>

# Code Standalone Container Acceptance

This acceptance verifies that Ordivant Code starts independently with the production Compose configuration. Work, Knowledge, and the Pi runtime are not part of this QA project. The checker inspects an already running Compose project; it does not create, stop, or delete containers or data volumes.

<span id="啟動與執行"></span>
<span id="启动与运行"></span>

## Start and run

Run these commands from the repository root in PowerShell:

```powershell
$env:ORDIVANT_WEB_PORT = '8091'
.\scripts\containers.ps1 -Products code -Seed -ProjectName ordivant-code-qa
$env:UV_CACHE_DIR = '.cache/uv'
uv run --project products/code/backend --no-sync python scripts/code_standalone_acceptance.py --project-name ordivant-code-qa
```

Omit `-WithGitea` so the services start with Gitea explicitly unconfigured. QA containers remain available for inspection after acceptance. To manage them, pass the same `-ProjectName` to `scripts/containers.ps1`.

<span id="驗收內容"></span>
<span id="验收内容"></span>

## What is checked

The checker requires exactly five running services in the Compose project: `code-api`, `code-db`, `web`, `identity-api`, and `identity-db`. Identity must be healthy, and first-run setup must not have been initialized by the test. It verifies that the web root loads a production bundle containing only the Code workspace. It then checks `/api/health` for the Code product, PostgreSQL, production mode, and `gitea_configured: false`.

The checker reads the seed bootstrap from the Code API container into process memory. It verifies that production `local-session` returns `403`, a manager can see both seed projects, writers and readers can see only the primary project, a writer cannot read the isolated project, and a reader receives `403` when creating a project. The manager creates an acceptance project with a unique key. This real project write must succeed and remain readable after restarting only `code-api`.

It also attempts to create a repository and requires an unconfigured Gitea response of `503` with `gitea_not_configured`. This means Git repository, branch, commit, pull request, and status operations remain unavailable; creating a project in metadata is not evidence of a Git write. Finally, an official MCP SDK stdio client runs inside the Code API container, verifies the exact set of nine tools, and performs read-only round trips to the Code REST service through `list_repositories` and `get_code_events`.

The JSON report is written to the ignored path `.data/validation/standalone-code-.../report.json` and records each check plus the first failed predicate. The bootstrap token is never included in the report or diagnostics. Final readiness checks run whether or not earlier checks pass.
