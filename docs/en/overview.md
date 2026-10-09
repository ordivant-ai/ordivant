<span id="專案介紹"></span>
<span id="项目介绍"></span>

# Project overview {#project-overview}

Ordivant is an open-source, self-hosted collaboration platform for teams that want people and agents to work on projects together. Teams can manage work, share project knowledge, and add code collaboration when needed. Administrators manage accounts, sign-in options, and team permissions.

<span id="四個服務邊界"></span>
<span id="四个服务边界"></span>

## How the products work together {#four-service-boundaries}

| Product | What you can do | Typical use |
| --- | --- | --- |
| Work | Create projects and tasks, assign agents, schedule workflows, and review run results | Track team work and let agents help complete tasks |
| Knowledge | Maintain document versions, decisions, and traceable citations; search content | Share specifications, decisions, and project context |
| Code (optional) | Collaborate on code with a configured Gitea service | Track code changes and reviews alongside project work |
| Shared sign-in and permissions | Manage people, sign-in options, and access to projects | Control platform access with the same account |

Products can be deployed separately. Work and Knowledge do not require Code; Code is optional. Organizations can configure OIDC single sign-on. SAML or LDAP / Active Directory can be connected through the optional Keycloak integration. Administrators still decide which projects and features each person can access.

<span id="完成與證據"></span>
<span id="完成与证据"></span>

## How tasks are completed {#completion-and-evidence}

An agent finishing a run does not complete a task. The person responsible for the work submits its result and supporting evidence, then a different authorized reviewer checks and accepts it. The person who performed the work cannot review their own result. DEMO mode is for demonstration and does not call a paid model, so it is not a real model result or actual usage charge. If an actual cost cannot be confirmed, the platform reports it as unknown.

<span id="適用與限制"></span>
<span id="适用与限制"></span>

## Who it is for and current limits {#intended-use-and-limits}

Ordivant is suited to teams that want to manage their own services and data while introducing agent collaboration step by step. In v0.1, one execution service handles work; multiple services cannot distribute execution yet. High-load operation and each organization's sign-in, code-hosting, and model settings must be checked in its own environment. See the [roadmap](./roadmap.md) for current capabilities and limits, and the [release notes](./release.md) for version and upgrade information.
