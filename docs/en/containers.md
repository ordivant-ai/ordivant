# Self-host Ordivant {#container-workflow}

<span id="development"></span>

Install Ordivant on your own computer or server with Docker Compose. These commands work on Linux, macOS, and Windows with Docker Desktop. PowerShell 7, host Python, and host Node.js are not required. Members joining an existing team can go straight to [getting started](guide/getting-started.md).

## Before installation {#deployment-prerequisites}

Install Git, Docker Engine or Docker Desktop, and Docker Compose v2. Use Linux containers in Docker Desktop. Check that `docker compose version` works. The first build needs internet access to download images and dependencies.

The default deployment name is `ordivant`, with a web address of `http://127.0.0.1:8088`. To use another name or port, create `.env` in the repository root; `.env.compose.example` is a template. Choose the deployment name and secrets directory before first installation, and keep using the same settings.

## Install and start {#production-targets}

Run these commands in order in your terminal:

```sh
git clone https://github.com/ordivant-ai/ordivant.git
cd ordivant
docker compose -f compose.init.yaml run --rm init
docker compose up -d --build --wait
```

The first Compose job prepares service settings without creating human accounts or sample tasks. The second command builds and starts Work, Knowledge, Code, and shared login. The first build takes some time; `--wait` waits for healthy services.

Open `http://127.0.0.1:8088/work`, create the initial administrator, and save the recovery codes. There is no default human password. The three products share login within this deployment, while their projects and permissions remain separate. Code repository operations also need the Gitea setup below.

### Enable automatic Agent execution {#enable-agent-execution}

To let Pi agents execute tasks, also run:

```sh
docker compose exec work-api python -m ordivant.bootstrap_runtime
docker compose --profile runtime up -d --build --wait runtime
```

Initialization creates only the execution service's machine identity: no DEMO project, Agent, or human account. Repeating it preserves valid configuration. It also works on an installation with existing work data. In Work, configure a provider and model under **Model connections**, then create a Pi worker in **Agent directory**. Select the Agent in a task's details and choose **Dispatch to agent**. See [model settings](model-usage.md) and [getting started](guide/getting-started.md).

An unconfigured Run is labeled DEMO and does not call a paid model. Skip the execution service if you only need manual tracking, submissions, and review. Add `COMPOSE_PROFILES=runtime` to `.env` to include it on subsequent ordinary starts.

## Install only the products you need {#individual-products}

For a new deployment, select the product in `.env`, run initialization, and use the corresponding start command. Use a separate deployment name and secrets directory to keep it isolated from another installation. Concurrent installations also need different `ORDIVANT_WEB_PORT` values.

| Product | Product settings in `.env` | Start command |
| --- | --- | --- |
| Work | `ORDIVANT_PRODUCT_MODE=work`, `ORDIVANT_WEB_API_UPSTREAM=http://work-api:8000` | `docker compose up -d --build --wait work-api web` |
| Knowledge | `ORDIVANT_PRODUCT_MODE=knowledge`, `ORDIVANT_WEB_API_UPSTREAM=http://knowledge-api:8010` | `docker compose up -d --build --wait knowledge-api web` |
| Code | `ORDIVANT_PRODUCT_MODE=code`, `ORDIVANT_WEB_API_UPSTREAM=http://code-api:8020` | `docker compose up -d --build --wait code-api web` |

Required login and database services start alongside the selected product. Work and Knowledge do not need Code or Gitea. Code needs Gitea for repository changes.

## Enable optional features {#optional-services}

### Code and Gitea {#enable-gitea}

Run in the same deployment:

```sh
docker compose --profile gitea up -d --wait gitea
docker compose -f compose.yaml -f compose.gitea-init.yaml --profile gitea run --build --rm gitea-init
docker compose up -d --no-deps --force-recreate --wait code-api
```

The initialization job configures Code's service connection without creating a default human login password. Return to Code to create projects, repositories, and PRs. Gitea's default address is `http://127.0.0.1:3002`. Keep `gitea` in `.env`'s `COMPOSE_PROFILES`, for example `runtime,gitea`, to include it on subsequent starts.

### Execution sandbox {#enable-sandbox}

Initialize the execution service first, then build the sandbox job image and start it:

```sh
docker compose -f compose.yaml -f compose.sandbox.yaml --profile sandbox build sandbox-job-image
docker compose -f compose.yaml -f compose.sandbox.yaml --profile runtime --profile sandbox up -d --build --wait runtime
```

If Gitea is enabled, add `--profile gitea` to the second command. Save the enabled configuration in `.env` so subsequent operations can use ordinary Compose commands:

```dotenv
COMPOSE_PATH_SEPARATOR=,
COMPOSE_FILE=compose.yaml,compose.sandbox.yaml
COMPOSE_PROFILES=runtime,gitea,sandbox
```

Remove `gitea` if it is not enabled. Sandboxes have no network access or host data mounts. Submit files you need to preserve before a Run ends. [Sandbox operations](execution-usage.md#sandboxes)

### Enterprise login and external tools {#enterprise-and-tools}

Connect your company's OIDC provider directly without an extra container. SAML and LDAP can use optional Keycloak; follow the [enterprise SSO guide](enterprise-sso.md#saml-ldap-and-active-directory). Add custom Compose files to the existing `COMPOSE_FILE` list without replacing an enabled sandbox configuration.

For external MCP tools, add exact hostnames to `.env`'s `ORDIVANT_TOOL_ALLOWED_HOSTS`, then restart Work and the execution service. Do not put model keys or human passwords in `.env`; enter model keys in the administration interface. [Tool connections](execution-usage.md#external-mcp-tools)

## Status, stopping, and backups {#actions-and-data}

Use the same repository directory, `.env`, and Compose configuration as installation:

```sh
docker compose ps
docker compose logs --tail 100 work-api identity-api
docker compose down
docker compose up -d --wait
```

`down` preserves volumes. Do not add `-v`, which deletes data. Back up product databases, data volumes, and `.data/container-secrets/` or your configured secrets directory together with model and SSO encryption keys. [Backup and restore](guide/operations.md)

Only in a fresh trial installation with no real accounts or business data, you may add DEMO examples before initializing execution or signing in for the first time:

```sh
docker compose exec work-api python -m ordivant.seed
docker compose exec knowledge-api python -m ordivant_knowledge.seed
docker compose exec code-api python -m ordivant_code.seed
```

Examples create sample projects and agents, without human passwords or model connections. A normal production installation does not need these commands; do not add examples to an existing installation.

## Provide team access through HTTPS {#https-access}

The web service binds to local `127.0.0.1:8088` by default. For remote team access, configure an HTTPS reverse proxy on the server to forward to this local address, then use your actual public address in `.env`:

```dotenv
ORDIVANT_AUTH_ORIGINS=https://ordivant.example.com
ORDIVANT_AUTH_COOKIE_SECURE=true
ORDIVANT_SSO_PUBLIC_ORIGIN=https://ordivant.example.com
```

Run `docker compose up -d --wait` to apply the settings. A proxy in another container must join the same Compose network and forward to `web:80`; host loopback is not that container's loopback. For enterprise login, also verify the identity provider's Callback URL. [Enterprise login settings](enterprise-sso.md)
