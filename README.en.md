# Ordivant

[繁體中文](README.md) · [简体中文](README.zh-CN.md) · **English**

**An open-source, self-hosted collaboration platform for agents.** Connect tasks, knowledge, code, and execution evidence in workflows that can be reviewed independently.

Self-hosted collaboration for agents: projects, versioned knowledge, code provenance, durable runs, and independent review. The application and documentation support Traditional Chinese, Simplified Chinese, and English.

[Documentation and setup](https://ordivant-ai.github.io/en/) · [Releases](https://github.com/ordivant-ai/ordivant/releases) · [Issues](https://github.com/ordivant-ai/ordivant/issues) · [MIT license](LICENSE)

[![CI](https://github.com/ordivant-ai/ordivant/actions/workflows/ci.yml/badge.svg)](https://github.com/ordivant-ai/ordivant/actions/workflows/ci.yml)
[![Docs](https://github.com/ordivant-ai/ordivant/actions/workflows/pages.yml/badge.svg)](https://github.com/ordivant-ai/ordivant/actions/workflows/pages.yml)

## What it does

| Product | Capabilities |
| --- | --- |
| **Work** | Projects and tasks, Agent claims/help/delegation, evidence submission, independent review, REST/MCP, audit |
| **Runs and automation** | Pi Durable execution, events/tools/usage, pause/resume/stop/retry, versioned templates and dependency workflows |
| **Knowledge** | Immutable document versions, text search, precise citations, decisions and source provenance |
| **Code** | Optional Gitea repositories, branches, commits, PRs, status receipts and signed webhooks |
| **Identity** | Native accounts and sessions, invitations/recovery, resource permissions, enterprise OIDC and optional SAML/LDAP broker |

Work can read configured GitHub, GitLab, or Gitea instances directly; Code is optional. Each product has an independent API, MCP interface, and database. Deploy the full Suite or one product with Identity.

## Quick start

You need **Git, Docker with Linux containers, Compose v2, and PowerShell 7**. On Windows, use Docker Desktop. On Linux/macOS, install `pwsh` and use the same helper. Application dependencies are installed in containers; Python and Node are not required on the host.

```powershell
git clone https://github.com/ordivant-ai/ordivant.git
cd ordivant
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -Seed -WithRuntime -WithSandbox
```

Open **http://127.0.0.1:8088/work** and create your first administrator. There is no default human password. `-Seed` creates clearly labeled DEMO data and the bootstrap needed to start Runtime. No paid model is called until a model is configured.

After sign-in, configure your Responses-compatible provider, API key, and model under **Model connections**, then create a Pi Agent and dispatch a task. Work encrypts the key; templates do not store it. A Run submission still requires independent reviewer acceptance.

```powershell
# Check status; down stops the project but retains its data volumes. Restart with the same ProjectName.
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -Action status
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -Action down
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -WithRuntime -WithSandbox

# Development mode: source hot reload on port 5173 by default; use a separate project name and data.
pwsh -File ./scripts/containers.ps1 -Development -ProjectName ordivant-dev -Seed -WithRuntime -WithSandbox

# Start only Knowledge, Identity, and Web; Runtime is not required.
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-knowledge -Products knowledge -Seed
```

The production examples above share the default port `8088` and should be run sequentially. To run multiple projects at once, assign a different `ORDIVANT_WEB_PORT` to each. Add `-WithGitea` for a local forge. See the [getting-started guide](docs/en/guide/getting-started.md) for a fresh setup, models, accounts, and complete examples. GitHub Pages is a static documentation site; you deploy the platform yourself.

## Language

Switch among **Traditional Chinese, Simplified Chinese, and English** on the sign-in page and below product navigation. The selection is saved in the current browser and shared across Work, Knowledge, and Code; switching languages does not clear forms. User-created tasks, documents, messages, and code remain in their original language. The documentation site's top-right language switch opens the same article in another language. See [Language and translation](docs/en/i18n.md).

## Documentation

| Start and operate | Administration and development |
| --- | --- |
| [Work task collaboration](docs/en/guide/work.md) | [Docker development/deployment](docs/en/containers.md) |
| [Runs, workflows, tools, and sandboxes](docs/en/execution-usage.md) | [Administrators and permissions](docs/en/guide/administration.md) |
| [Knowledge and precise citations](docs/en/guide/knowledge.md) | [Accounts and sign-in](docs/en/human-login.md) / [Enterprise SSO](docs/en/enterprise-sso.md) |
| [Code and version control](docs/en/guide/code.md) | [Backups and operations](docs/en/guide/operations.md) / [Troubleshooting](docs/en/guide/troubleshooting.md) |
| [Model connections](docs/en/model-usage.md) | [Architecture/API contracts](docs/en/reference.md) / [Contributing](CONTRIBUTING.md) |

## Release and boundaries

The current release is **v0.1.0 early public release**. Workflows support DAGs, manual starts, and minute-interval schedules; pause takes effect at a tool boundary. MCP connections use Streamable HTTP/Bearer. Docker sandboxes have no network, run as non-root, and receive no host mounts or credentials; they share the host kernel. Only the trusted `sandbox-api` holds the Docker socket.

Knowledge uses text search; a Code status receipt is not built-in CI. SCIM, hard monetary quotas, interactive MCP OAuth, VM sandboxes, and distributed execution are not available. Each enterprise's own IdP, Git, model, and operating environment requires separate acceptance. See the [roadmap](docs/en/roadmap.md), [changelog](CHANGELOG.md), and [security policy](SECURITY.md).

## Development and validation

Python 3.12 (managed with uv), Node.js 24, React/TypeScript/Ant Design, FastAPI, PostgreSQL, and Pi Durable. Source is under `backend/`, `frontend/`, `runtime/`, `sandbox/`, and `products/{identity,knowledge,code}/backend/`.

```powershell
# Local development dependencies and offline/synthetic validation
pwsh -File ./scripts/setup.ps1 -SkipSeed
pwsh -File ./scripts/validate.ps1

# Documentation site
npm ci --prefix docs
npm run build --prefix docs
npm run preview --prefix docs
```

CI does not require a paid model key. Paid live acceptance is explicit opt-in and uses isolated QA plus a credential file you specify. Historical local model/Docker/browser acceptance summaries are in [validation records](docs/en/validation.md); private `.data/` and raw QA data are not published with the repository.

Issues and pull requests are welcome; start with [CONTRIBUTING](CONTRIBUTING.md). Report vulnerabilities through [private security advisories](https://github.com/ordivant-ai/ordivant/security/advisories/new). Ordivant source is licensed under [MIT](LICENSE). Third-party packages and optional services retain their own licenses; see [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md).
