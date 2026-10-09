<span id="排除常見問題"></span>
<span id="排除常见问题"></span>

# Troubleshooting

<span id="啟動與登入"></span>
<span id="启动与登录"></span>

## Startup and sign-in

| Symptom | Cause or check | Resolution |
|---|---|---|
| The helper cannot find Docker Compose | Docker Desktop/Docker Engine is stopped, or Compose v2 is not installed. | Confirm that `docker compose version` runs, and use Linux containers with Docker Desktop. |
| PowerShell command is not recognized | The command is using Windows PowerShell instead of PowerShell 7. | Install or start `pwsh` and run `scripts/containers.ps1` from the repository root. Use forward slashes on Linux. |
| A service port is already in use at startup | Another local process or Compose project uses the port. | Change the port with the matching environment variable, such as `ORDIVANT_DEV_WEB_PORT` or `ORDIVANT_GITEA_PORT`, then restart with the same project name. |
| The page reports that the API is unreachable | The API is not healthy yet, the image is still building, or a different Compose project was selected. | Wait for the helper to finish. Check services with `-Action status`, then use `-Action logs` with the same project name and enabled profiles. |
| The initial administrator setup page does not appear | This Identity volume was already initialized, or the selected Compose project is different. | Check `-ProjectName` and `-Development`. There is no default account; use the existing administrator or recovery flow. Do not delete the volume to try a password. |
| Sign-in succeeds but no Project or Space is visible | The human session exists, but the product resource scope was not granted. | Ask an Identity administrator to assign the correct product role and explicit resource scope. An SSO email domain does not grant data access automatically. |

<span id="seed、runtime-與-run"></span>
<span id="seed、runtime-与-run"></span>

## Seed, Runtime, and Runs

| Symptom | Cause or check | Resolution |
|---|---|---|
| Runtime reports that Work bootstrap is missing | `-Seed` has not created a bootstrap file in the new Work volume; Runtime does not generate data itself. | In a new DEMO environment, start once with `-Seed`, then add `-WithRuntime` under the same project. If real data already exists, verify the backup and data directory first; do not seed casually. |
| Demo tasks are not visible | Seeding is opt-in, or startup selected only some products. | Check `-Products` and the project name. Use `-Seed` explicitly only when you intend to create DEMO data. |
| A Run remains queued or waiting | Runtime is stopped, the Agent lacks the required capability or scope, a prerequisite Task has not been accepted, or no Agent is available. | Confirm Work Runtime is healthy. Check the Agent's role, Project scope, capabilities, and workflow dependency/review state. |
| The execution result is marked DEMO | A valid model connection has not been configured for the organization or Agent. | An administrator configures the provider endpoint, key, and model in Work, then sets the Agent to inherit or override it. DEMO does not mean a paid model was used. |
| The upstream tool result is unclear after Stop | Stop revokes Run write authority, but an external service may already have applied a side effect. | Check the actual result in that upstream service before deciding whether to create a new Run. The system does not automatically replay an uncertain external operation. |

<span id="knowledge、code-與-sso"></span>
<span id="knowledge、code-与-sso"></span>

## Knowledge, Code, and SSO

| Symptom | Cause or check | Resolution |
|---|---|---|
| Knowledge search does not find semantically similar content | Search currently matches title and body text; it is not vector or RAG search. | Search for exact words in the body, the document title, or tags. Confirm that you have access to the Space. |
| Publishing a Knowledge version reports a conflict | Another writer has updated the expected version. | Load the latest version, inspect its changes and citations, then edit and publish against that version. Existing versions are never overwritten. |
| Code is readable, but repositories or PRs cannot be created | The Gitea profile is stopped or the Code API is not connected to Gitea. | Start the same development Compose project with `-WithGitea`, wait for the health check, and retry in Code. Do not put the Gitea service credential in a browser. |
| A PR has a status but it is unclear whether tests ran | `agent_reported` is a submitted status receipt, not a CI runner record. | Check the receipt source. Only a verifiable Gitea webhook or external test-system record proves its corresponding event; do not describe a reported status as a CI result. |
| OIDC callback or sign-in loops fail | The IdP Redirect URI differs from the Callback URL shown by the administration UI, or the canonical HTTPS origin/cookie configuration is wrong. | Check the complete callback URL, Issuer, allowed domains, and trusted public origin. Test with one member before changing sign-in policy. See [enterprise sign-in](../enterprise-sso.md) for setup. |

<span id="資料與服務目錄"></span>
<span id="数据与服务目录"></span>

## Data and service directories

- If data seems to disappear after changing the clone path, the helper may have selected a different default Compose project name. Set `-ProjectName` explicitly at startup and use it for status, logs, and down.
- `-Action down` preserves data. Running `docker compose down -v` afterward removes volumes and loses data. Do not treat volume removal as a routine troubleshooting step.
- Do not paste `.data/container-secrets`, bootstrap files, IdP client secrets, or Gitea settings into logs or issues. The helper masks known service secrets in logs; inspect the output before sharing it publicly anyway.
- Backups must include databases, data volumes, and their encryption keys. See [Operations and backups](operations.md).
- Work, Knowledge, and Code have separate service and data boundaries; one healthy product does not mean the others are available. Check each product's own health/status, then check shared Identity or dependency services.
