# Container workflow

`scripts/containers.ps1` builds and runs the selected products through Docker Compose. The host needs Docker Engine/Desktop with Docker Compose; it does not need `uv`, Python, Node.js, or npm.

## Development

Start the full development suite, explicitly create local demo data, and enable the optional Gitea and Pi runtime services:

```powershell
.\scripts\containers.ps1 -Development -Seed -WithGitea -WithRuntime
```

The helper builds the selected development targets, waits for the APIs and web service, seeds only the selected APIs when `-Seed` is supplied, bootstraps the local Gitea service account when `-WithGitea` is supplied, and starts the runtime only after Work has a bootstrap file. Configured Work dispatches use their live model connection; unconfigured dispatches keep a visibly marked deterministic demo fallback. See [model settings](model-usage.md).

Development mode mounts product source into the containers and provides the same complete account login as production. Identity API `8030` and its independent PostgreSQL are included for every selected product. Default host ports are Work API `8000`, Knowledge API `8010`, Code API `8020`, web `5173`, runtime `8090`, and Gitea `3002`. Override Compose port variables in the shell when a port is already in use.

To run one product's standalone frontend and API without starting its peers:

```powershell
.\scripts\containers.ps1 -Development -Products knowledge -Seed
.\scripts\containers.ps1 -Development -Products code -Seed -WithGitea
```

One selected product sets `ORDIVANT_PRODUCT_MODE` to that product and directs the web API upstream to its API container. Supported selections are one product, all three products, or a pair that includes Work. A Knowledge+Code-only pair is rejected because suite routing needs Work as the `/api` upstream. Supported multi-product selections use suite mode and route `/api` to `work-api`.

## Production Targets

On first startup the web page asks the user to create the initial administrator with their own password. There is no default human account; `-Seed` creates only business DEMO fixtures and agent credentials. Development and production have separate Identity volumes and project-specific cookie names. See [human login](human-login.md) for invitations, permissions, password recovery and session revocation. All configured products refuse the old local-session endpoint in both modes.

The helper derives exact `ORDIVANT_AUTH_ORIGINS` from the selected web host port unless explicitly supplied. For a remote HTTPS deployment, configure the public origin and `ORDIVANT_AUTH_COOKIE_SECURE=true`. Insecure cookies are accepted only with literal HTTP loopback origins. Identity service secrets and database connection files stay in each project's ignored secret directory.

Omit `-Development` to build and run the production Docker targets. Local-session authentication remains disabled:

```powershell
.\scripts\containers.ps1 -Action up
.\scripts\containers.ps1 -Action up -Products knowledge
```

The full selection uses suite frontend mode and Work as the `/api` upstream. A single selected Knowledge or Code product builds that product's standalone frontend. The default production web port is `8088`. Default development and production Compose project names both include a hash of the repository's absolute path, so another checkout gets a separate project and secret directory. Use `-ProjectName` to select a stable, explicitly named instance.

To keep development and production up at the same time, give them separate Compose project names and nonconflicting host ports. This example runs development Gitea on `3003` and production Gitea on its default `3002`:

```powershell
$env:ORDIVANT_DEV_WEB_PORT = '5173'
$env:ORDIVANT_WEB_PORT = '8088'
$env:ORDIVANT_GITEA_PORT = '3003'
.\scripts\containers.ps1 -Development -ProjectName ordivant-dev-local -Seed -WithGitea -WithRuntime
Remove-Item Env:ORDIVANT_GITEA_PORT
.\scripts\containers.ps1 -ProjectName ordivant-prod-local -WithGitea
```

The two invocations use separate project-scoped volumes and `.data/container-secrets/<ProjectName>/` directories. The production command does not seed demo data.

## Actions And Data

`-Action` accepts `up` (default), `down`, `status`, and `logs`. Use the same `-Development` and `-ProjectName` values to address the same project. For example:

```powershell
.\scripts\containers.ps1 -Development -Action status
.\scripts\containers.ps1 -Development -Action logs -WithGitea -WithRuntime
.\scripts\containers.ps1 -Development -Action down
```

`down` stops only the selected Compose project and preserves its named database, product, runtime, and Gitea volumes. It never uses `down -v` and does not remove secrets or data.

`-Seed` is explicit and runs each selected product's seed module inside its API container. Seed data and generated bearer tokens are local DEMO data; they do not configure enterprise SSO. If `-WithRuntime` is used without `-Seed`, the helper requires an existing Work `/data/bootstrap.json` in that Compose project's persistent volume and fails without creating one.

`-WithRuntime` requires `work` in `-Products`. `-WithGitea` starts the `gitea` profile and publishes Gitea on loopback port `3002` by default. Its generated `ordivant-local` service account uses a random password that is neither stored nor printed; a scoped service token and webhook secret are stored locally for Code. Existing credentials are verified and retained on repeat runs. If stored credentials cannot be verified, the helper stops and does not rotate them silently.

`-WithSandbox` additionally requires Work and `-WithRuntime`. It adds `compose.sandbox.yaml`, builds the fixed sandbox job image, and starts an internal trusted executor before runtime. Only `sandbox-api` holds the Docker daemon socket; job/runtime/web do not. Jobs are non-root, read-only, networkless, resource-limited and use an isolated bounded tmpfs workspace per run. A generated `sandbox_service_token` stays in the project secret directory. See [execution usage](execution-usage.md) for controls, templates, workflow schedules, endpoint host policies and the optional owned `-ExecutionQaFixture` on 8092. Sandbox workspace contents are ephemeral and are not included in data volume backups.

Each Compose project stores generated service credentials under `.data/container-secrets/<ProjectName>/`. The directory contains 64-hex database passwords, PostgreSQL URL files, the internal Identity service token, the development proxy token, and `gitea.json` (initially `{}`). Database volumes, including Identity, are also namespaced by Compose project. The files are ignored by Git; keep them local, do not print or publish them, and back them up securely if the matching database volumes must remain usable. Human passwords are never generated by the helper.

Production builds use `ORDIVANT_MODE=production`; local-session authentication is unavailable. Explicit `-Seed` still writes demonstration principals and generated local bearer credentials, so use it only when demo data is intended.

If a Docker Compose operation fails, the helper includes its last 15 output lines after redacting known project secrets, long hex credentials, password-bearing lines, and URL userinfo. It does not print the complete Docker command or secret-file contents.

## Gitea URLs

Code connects to `http://gitea:3000` inside the Compose network. Browser and clone URLs use Gitea's configured `ROOT_URL`; `PUBLIC_URL_DETECTION=never` keeps an internal API request from changing those links to `gitea:3000`. Set `ORDIVANT_GITEA_PUBLIC_URL` to the intended public Gitea URL for another host. The default remains the loopback URL at `ORDIVANT_GITEA_PORT`. See the [official Gitea server configuration](https://docs.gitea.com/administration/config-cheat-sheet/#server-server).

Work uses its own project-scoped `/data/vcs.json` for existing VCS access. Its Compose configuration explicitly permits the private HTTP host `gitea`; other HTTP hosts require the operator's `ORDIVANT_VCS_HTTP_HOSTS` allowlist. Callers cannot supply a server URL through a task or tool request.

## Enterprise Identity Broker

The shared Identity service supports direct OIDC without an extra container. Configure the provider in Account & Security; each Compose project keeps its own encrypted settings and identity records. Keep `identity_data/sso.key` with the Identity database backup. The administrator chooses the canonical `ORDIVANT_SSO_PUBLIC_ORIGIN` from the exact trusted auth origins.

For SAML or LDAP/AD federation, add the optional Keycloak 26.8.0 broker and its independent PostgreSQL:

```powershell
.\scripts\containers.ps1 -Development -WithIdentityBroker
.\scripts\containers.ps1 -Development -Action status -WithIdentityBroker
```

The broker binds to loopback `8093`; override `ORDIVANT_BROKER_PORT` and `ORDIVANT_BROKER_PUBLIC_URL` before startup when needed. It has no default human administrator. Bootstrap its administrator through the interactive WSL tmux steps in [enterprise SSO](enterprise-sso.md). `-WithIdentityBroker` configures explicit internal backchannel routing; external IdPs use verified HTTPS. Private enterprise CA bundles can be mounted and selected with `ORDIVANT_SSO_CA_BUNDLE`.

The isolated protocol fixture is an explicit QA workflow and never initializes a human account in the main environment:

```powershell
.\scripts\sso-containers.ps1 -Action up
uv --cache-dir .cache/uv run --project products/identity/backend --no-sync python scripts/sso_acceptance.py
uv --cache-dir .cache/uv run --project products/identity/backend --no-sync python scripts/sso_storage_acceptance.py
.\scripts\sso-containers.ps1 -Action down
```

It uses project `ordivant-sso-qa`, application `8092`, broker `8093`, separate volumes/secrets and two synthetic realms. It requires host `uv` for fixture generation. An existing service on those ports must first be stopped using its own project helper. `-Action reimport` replaces only the generated QA realms with the broker stopped; it is not used for real organizational identities. Reports contain checks and resource identifiers, not credentials. See [SSO acceptance](sso-validation.md).

## MCP Without Host Python

Each API image includes its own stdio MCP server. Configure the MCP client to execute `docker` with the matching project's Compose file and scoped token environment variable. No host Python environment or Pi runtime is required. For example, the following command forwards a token already configured in the client process environment; its value does not appear in command arguments:

```powershell
$env:ORDIVANT_SECRETS_DIR = Join-Path (Get-Location) '.data/container-secrets/ordivant-dev'
docker compose -p ordivant-dev -f compose.yaml -f compose.dev.yaml exec -T -e ORDIVANT_KNOWLEDGE_API_TOKEN knowledge-api python -m ordivant_knowledge.mcp_server
```

Use the actual project name and absolute Compose paths in an external MCP client's configuration. Work uses `ORDIVANT_API_TOKEN` and `python -m ordivant.mcp_server`; Code uses `ORDIVANT_CODE_API_TOKEN` and `python -m ordivant_code.mcp_server`. Issue each agent its product-scoped credential; do not use a Gitea service token as an Ordivant bearer token. The standalone Knowledge acceptance exercises the official MCP SDK and server entirely inside its own API container.

The reproducible container checks are documented in [Suite validation](container-validation.md), [standalone Knowledge validation](standalone-container-validation.md), [standalone Code validation](code-standalone-validation.md), and [hot reload validation](hot-reload-validation.md). The completed local results are recorded in [the validation ledger](validation.md).

The delivery keeps the local development suite on `5173` with Gitea on `3002`, and the production-target QA suite on `8088` with Gitea on `3003`. The temporary standalone Knowledge/Code QA containers were stopped after acceptance; their data volumes, secrets and reports were retained. Neither suite is deployed remotely.
