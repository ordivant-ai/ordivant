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

To keep development and production up at the same time, give them separate Compose project names and nonconflicting host ports. The commands below are adjustable examples; choose names, available ports, and optional services for your deployment:

```powershell
$env:ORDIVANT_DEV_WEB_PORT = '5173'
$env:ORDIVANT_WEB_PORT = '8088'
$env:ORDIVANT_GITEA_PORT = '3003'
.\scripts\containers.ps1 -Development -ProjectName ordivant-dev-example -Seed -WithGitea -WithRuntime
Remove-Item Env:ORDIVANT_GITEA_PORT
.\scripts\containers.ps1 -ProjectName ordivant-prod-example -WithGitea
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

`-WithRuntime` requires `work` in `-Products`. `-WithGitea` starts the `gitea` profile and publishes Gitea on loopback port `3002` by default. The helper initializes a local Gitea service identity and stores the required service credentials in that Compose project's local secret directory. Existing credentials are verified and retained on repeat runs. If they cannot be verified, the helper stops rather than silently replacing them.

`-WithSandbox` additionally requires Work and `-WithRuntime`. It adds `compose.sandbox.yaml`, builds the fixed sandbox job image, and starts an internal trusted executor before runtime. Only `sandbox-api` holds the Docker daemon socket; job/runtime/web do not. Jobs are non-root, read-only, networkless, resource-limited and use an isolated bounded tmpfs workspace per run. Generated service credentials stay in the project secret directory. See [execution usage](execution-usage.md) for controls, templates, workflow schedules, and endpoint host policies. Sandbox workspace contents are ephemeral and are not included in data volume backups.

Each Compose project has separate data volumes and a local secret directory. These secret files are ignored by Git; do not commit or publish them. To preserve and restore a project's databases, securely back up its volumes, secret directory, and Identity encryption key together. Stopping containers does not delete this data.

Production builds use `ORDIVANT_MODE=production`; local-session authentication is unavailable. Explicit `-Seed` still writes demonstration principals and generated local bearer credentials, so use it only when demo data is intended.

Before sharing Docker Compose error output, check that it contains no secrets, personal data, or internal URLs.

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

The broker binds to loopback `8093`; override `ORDIVANT_BROKER_PORT` and `ORDIVANT_BROKER_PUBLIC_URL` before startup when needed. It has no default human administrator. Follow the interactive bootstrap steps in [enterprise SSO](enterprise-sso.md), then remove the temporary account after creating a permanent administrator. Do not put the password in commands, environment variables, or files. `-WithIdentityBroker` configures explicit internal backchannel routing; external IdPs use verified HTTPS. Private enterprise CA bundles can be mounted and selected with `ORDIVANT_SSO_CA_BUNDLE`.

## MCP Without Host Python

Each API image includes its own stdio MCP server. Configure the MCP client to execute `docker` with the matching project's Compose file and scoped token environment variable. No host Python environment or Pi runtime is required. For example, the following command forwards a token already configured in the client process environment; its value does not appear in command arguments:

```powershell
$env:ORDIVANT_SECRETS_DIR = Join-Path (Get-Location) '.data/container-secrets/ordivant-example'
docker compose -p ordivant-example -f compose.yaml -f compose.dev.yaml exec -T -e ORDIVANT_KNOWLEDGE_API_TOKEN knowledge-api python -m ordivant_knowledge.mcp_server
```

Use the Compose project name and file paths from your deployment in an external MCP client's configuration. Work uses `ORDIVANT_API_TOKEN` and `python -m ordivant.mcp_server`; Knowledge uses `ORDIVANT_KNOWLEDGE_API_TOKEN` and `python -m ordivant_knowledge.mcp_server`; Code uses `ORDIVANT_CODE_API_TOKEN` and `python -m ordivant_code.mcp_server`. Issue each agent its product-scoped credential; do not use a Gitea service token as an Ordivant bearer token.
