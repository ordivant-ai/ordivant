<span id="專案介紹"></span>
<span id="项目介绍"></span>

# Project overview {#project-overview}

Ordivant is a self-hosted collaboration platform where people and agents deliver work within explicit project scopes. Work plans tasks and reviews agent runs; Knowledge preserves versioned documents and decisions; Code manages repositories and pull requests when Gitea is configured. Read the [feature guide](./features.md), then start with [your first project](./guide/first-project.md) and [team setup](./guide/team-setup.md).

<span id="使用者與團隊"></span>

## People and teams {#roles-and-teams}

Ordivant suits product, engineering, research, and operations teams that need traceable deliverables, clear handoffs, or a review step for agent-assisted work. Administrators grant people and agents access to products and resource scopes. A person may have different roles in each product.

| Participant | Responsibility in Ordivant |
| --- | --- |
| Organization administrator | Invites members, configures sign-in, and grants access to Work projects, Knowledge spaces, and Code projects. |
| Work manager | Creates and assigns tasks and manages workflows and run dispatch within authorized projects. |
| Agent | Performs authorized work, reports progress, and submits results. A template does not grant project access. |
| Work reviewer | Checks task results and evidence. The submitter cannot review their own work. |
| Knowledge writer / reader | Writers publish document versions and decisions; readers search and read spaces they can access. |
| Code writer / reader | Writers manage repository changes and PRs in authorized projects; readers inspect content and status. |

<span id="典型工作日"></span>

## A typical workday {#typical-workday}

1. A work lead creates tasks in a Work project, records goals, inputs, scope, constraints, and acceptance criteria, then sets dependencies for prerequisite work.
2. An agent performs assigned work. It can request collaboration or delegate a separable deliverable as a child task. A manager can inspect run status in the Runs view.
3. After submission, a different authorized person checks the evidence and accepts or returns the result. A returned result keeps its earlier runs and evidence.
4. The team stores durable specifications, decisions, and sources in Knowledge, then cites an exact document version in later tasks. For code work, it creates a branch, commit, and PR in Code and follows the team's Gitea review process.

Each product keeps its own access scope. A citation to another product does not grant permission to read it.

<span id="四個服務邊界"></span>
<span id="四个服务边界"></span>

## Choose a product {#four-service-boundaries}

| Product | When to use it | Main result |
| --- | --- | --- |
| Work | Assign work to people or agents, track dependencies, collaborate, run tasks, and review results. | Tasks, execution history, submitted evidence, and review decisions. |
| Knowledge | Preserve specifications, decisions, version history, and source citations. | Immutable document versions, decision records, and exact-version citations. Search is currently text-based. |
| Code (optional) | Manage Gitea repositories, branches, commits, and PRs inside Ordivant. | Code changes, PRs, source references, and status receipts. Gitea must be configured by the deployment. |

The three products use shared Identity sign-in, but have separate product roles and resource permissions and can be deployed independently. Work does not require Code. If your team uses GitHub, GitLab, or Gitea, Work can also display configured external PR and check status as a read-only view; it cannot merge a PR. See the [feature guide](./features.md) for details and entry points.

<span id="快速開始與操作指南"></span>

## Getting started and user guides {#start-here}

- [Create your first project](./guide/first-project.md) and [set up a team](./guide/team-setup.md).
- [Work tasks and reviews](./guide/work.md), [Knowledge documents](./guide/knowledge.md), and [Code pull requests](./guide/code.md).
- [Model connections](./model-usage.md), [Runs, workflows, tools, and sandboxes](./execution-usage.md), and [administrator and enterprise sign-in](./guide/administration.md).

<span id="完成與證據"></span>
<span id="完成与证据"></span>

## How tasks are completed {#completion-and-evidence}

An agent finishing a run does not complete a task. The person responsible for the work submits its result and supporting evidence, then a different authorized reviewer checks and accepts it. The person who performed the work cannot review their own result. DEMO mode is for demonstration and does not call a paid model, so it is not a real model result or actual usage charge. If an actual cost cannot be confirmed, the platform reports it as unknown.

<span id="適用與限制"></span>
<span id="适用与限制"></span>

## Intended use and current limits {#intended-use-and-limits}

Ordivant suits teams that want to operate their own services and data while introducing agent collaboration gradually. Products can be deployed independently, but sign-in, model providers, external tools, and code-hosting services still need environment-specific setup. Run usage does not always include a verifiable dollar cost; the model provider bills actual usage. External MCP tools may change upstream data. Sandbox workspaces are temporary and do not provide VM-level isolation. See the [feature guide](./features.md) and each user guide for details.

Work currently uses a single execution service; multiple services cannot distribute runs yet. High-load operation and each organization's sign-in, code-hosting, and model setup must be checked in that environment. See the [roadmap](./roadmap.md) for current capabilities and limits, and the [release notes](./release.md) for version and upgrade information.
