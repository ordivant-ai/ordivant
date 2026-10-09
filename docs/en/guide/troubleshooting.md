<span id="排除常見問題"></span>
<span id="排除常见问题"></span>

# Troubleshooting {#troubleshooting}

<span id="啟動與登入"></span>
<span id="启动与登录"></span>

## Startup and sign-in {#startup-and-sign-in}

| Symptom | Cause or check | Resolution |
|---|---|---|
| Docker Compose will not start | Docker Engine is stopped, or Compose v2 is not installed. | Confirm that `docker compose version` runs, and start Docker Desktop or Docker Engine. |
| A service port is already in use at startup | Another local process uses the port. | Change `ORDIVANT_WEB_PORT` or `ORDIVANT_GITEA_PORT` in the repository-root `.env`, then start with the same deployment name and profiles. |
| The page reports that the API is unreachable | The API is not healthy yet, the image is still building, or a different Compose project was selected. | From the repository root, run `docker compose ps` and `docker compose logs --tail 100 work-api`. Confirm the deployment name, profiles, and Compose file set are the same. |
| The initial administrator setup page does not appear | This Identity volume was already initialized, or the selected Compose project is different. | Run `docker compose ls`; `compose.yaml` sets the default deployment name to `ordivant`. Check `COMPOSE_PROJECT_NAME` in the repository-root `.env` only if you customized the name. There is no default account; use the existing administrator or recovery flow. Do not delete the volume to try a password. |
| Sign-in succeeds but no Project or Space is visible | The human session exists, but the product resource scope was not granted. | Ask an Identity administrator to assign the correct product role and explicit resource scope. An SSO email domain does not grant data access automatically. |

<span id="seed、runtime-與-run"></span>
<span id="seed、runtime-与-run"></span>

## Runtime and model settings {#seed-runtime-and-runs}

| Symptom | Cause or check | Resolution |
|---|---|---|
| Runtime cannot start because its machine identity is missing | Work API is not healthy yet, or Runtime bootstrap has not completed. | Start Work API, then run `docker compose exec work-api python -m ordivant.bootstrap_runtime` and `docker compose --profile runtime up -d --build --wait runtime`. This does not require Seed or create people or projects; a valid `runtime_token` is not rotated. |
| DEMO examples are not visible | Seeding is optional; a fresh environment has no DEMO data by default. | Only in a brand-new trial with no real data, create DEMO before Runtime bootstrap. Choose one product's Seed command from [Operations and backups](operations.md). Never seed an existing deployment. |
| A Run remains queued or waiting | Runtime is stopped, the Agent lacks the required capability or scope, a prerequisite Task has not been accepted, or no Agent is available. | Run `docker compose --profile runtime ps` and `docker compose --profile runtime logs --tail 100 runtime`. Check the Agent's role, Project scope, capabilities, and workflow dependency/review state. If Sandbox is enabled, use the same `-f compose.yaml -f compose.sandbox.yaml` files. |
| The execution result is marked DEMO | A valid model connection has not been configured for the organization or Agent. | An administrator configures the provider, API key, and model on the Work model management page, checks the Agent settings, and dispatches a new Run. DEMO does not mean a paid model was used. |
| The upstream tool result is unclear after Stop | Stop revokes Run write authority, but an external service may already have applied a side effect. | Check the actual result in that upstream service before deciding whether to create a new Run. The system does not automatically replay an uncertain external operation. |

<span id="knowledge、code-與-sso"></span>
<span id="knowledge、code-与-sso"></span>

## Knowledge, Code, and SSO {#knowledge-code-and-sso}

| Symptom | Cause or check | Resolution |
|---|---|---|
| Knowledge search does not find semantically similar content | Search currently matches title and body text; it is not vector or RAG search. | Search for exact words in the body, the document title, or tags. Confirm that you have access to the Space. |
| Publishing a Knowledge version reports a conflict | Another writer has updated the expected version. | Load the latest version, inspect its changes and citations, then edit and publish against that version. Existing versions are never overwritten. |
| Code is readable, but repositories or PRs cannot be created | The Gitea profile is stopped, initialization is incomplete, or the Code API has not reconnected to Gitea. | Start and initialize Gitea with the commands below, then recreate the Code API. Do not put the Gitea service credential in a browser. |
| A PR has a status but it is unclear whether tests ran | `agent_reported` is a submitted status receipt, not a CI runner record. | Check the receipt source. Only a verifiable Gitea webhook or external test-system record proves its corresponding event; do not describe a reported status as a CI result. |
| OIDC callback or sign-in loops fail | The IdP Redirect URI differs from the Callback URL shown by the administration UI, or the canonical HTTPS origin/cookie configuration is wrong. | Check the complete callback URL, Issuer, allowed domains, and trusted public origin. Test with one member before changing sign-in policy. See [enterprise sign-in](../enterprise-sso.md) for setup. |

To enable Gitea, run these commands from the repository root using the same Compose project:

```sh
docker compose --profile gitea up -d --wait gitea
docker compose -f compose.yaml -f compose.gitea-init.yaml --profile gitea run --rm gitea-init
docker compose up -d --no-deps --force-recreate --wait code-api
```

<span id="資料與服務目錄"></span>
<span id="数据与服务目录"></span>

## Data and service directories {#data-and-service-directories}

- The default Compose project name is `ordivant`, set by `compose.yaml`. For a custom `.env`, check that `COMPOSE_PROJECT_NAME` matches the original deployment; run `docker compose ls` to see active projects.
- `docker compose down` preserves data. `docker compose down -v` removes volumes and loses data. Do not treat volume removal as a routine troubleshooting step.
- Do not paste the default `.data/container-secrets/`, a custom `ORDIVANT_SECRETS_DIR`, bootstrap data, IdP client secrets, or Gitea settings into logs or issues. Inspect Docker logs for secrets before sharing them.
- Backups must include databases, data volumes, and their encryption keys. See [Operations and backups](operations.md).
- Work, Knowledge, and Code have separate service and data boundaries; one healthy product does not mean the others are available. Check each product's own health/status, then check shared Identity or dependency services.
- When Sandbox is enabled, use the same `-f compose.yaml -f compose.sandbox.yaml` file set and profiles for every later Compose command.
