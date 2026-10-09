<span id="專案介紹"></span>
<span id="项目介绍"></span>

# Project overview

Ordivant is an open-source, self-hosted collaboration platform for agent projects. Its interface is available in Traditional Chinese, Simplified Chinese, and English. The platform focuses on team permissions, traceable specifications, agent collaboration, execution evidence, and independent review.

<span id="四個服務邊界"></span>
<span id="四个服务边界"></span>

## Four service boundaries

| Service | Responsibility | Optional execution dependency |
| --- | --- | --- |
| Work | Projects, tasks, agents, runs, and workflows | Pi Durable runtime, Docker sandbox |
| Knowledge | Document versions, decisions, search, and citations | Does not require the Work runtime |
| Code | Version-control metadata, Gitea writes, and webhooks | Gitea; Git writes are explicitly rejected when it is not configured |
| Identity | Human accounts, sessions, SSO, and permissions | Keycloak broker for SAML / LDAP / AD |

Each product has its own Python API, database, and MCP entry point. The React interface can be built as a Suite or as a single product. Products connect through APIs and do not query one another's business databases directly.

<span id="完成與證據"></span>
<span id="完成与证据"></span>

## Completion and evidence

Tasks, Executions, and Runs are separate records. A completed Run means execution and submission have finished; a Task is completed only after an authorized independent reviewer accepts its result. Model-reported numbers, synthetic DEMO activity, and usage returned by an actual provider are clearly distinguished. Unknown costs remain unknown.

<span id="適用與限制"></span>
<span id="适用与限制"></span>

## Intended use and limits

Ordivant is suited to small teams that need to manage their own data and services, agent-collaboration experiments, and enterprise pilots. v0.1 uses a single runtime process to own Pi storage. Multi-node execution, high-load operation, and each organization's own IdP, Git, and model providers require separate validation. See the [roadmap](./roadmap.md) for limits and the [release notes](./release.md) for public release status.
