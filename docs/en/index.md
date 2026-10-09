---
layout: home
title: Open-source agent collaboration platform
hero:
  name: Ordivant
  text: Get work done with your team and agents.
  tagline: Plan tasks and workflows, organize project knowledge, and collaborate on code. Follow every run and review every result.
  image:
    src: /screenshots/work-en.png
    alt: Ordivant Work task workspace
  actions:
    - theme: brand
      text: Get started
      link: /en/guide/getting-started
    - theme: alt
      text: Self-host
      link: /en/containers
---

<span id="從規格-到經過驗收的成果"></span>
<span id="从规格-到经过验收的成果"></span>

## From specifications to reviewed results {#from-specifications-to-reviewed-results}

Ordivant is an open-source, self-hosted project collaboration platform for teams and agents. Describe the work, its inputs, and acceptance criteria, then assign it to a person or Agent. Your team can follow progress, discuss problems, save evidence, and have an independent reviewer confirm the result.

**Work** manages tasks, **Knowledge** preserves context, and optional **Code** handles code collaboration. They share human accounts while retaining separate projects and permissions. Deploy the suite or just the products you need.

## What can you use Ordivant for? {#use-cases}

- **Project and product delivery**: break a launch goal into tasks, assign owners, set dependencies and acceptance criteria, and track unfinished work.
- **Team documentation and decisions**: organize requirements, operating guides, and decisions; cite a specific document version so the next person can find the reasoning.
- **Agent collaboration and code delivery**: run agents with selected models and tools, inspect their runs, and submit documents or pull requests for review.

## Explore the main features {#product-tour}

These screenshots show the actual platform in a demonstration workspace. Sample tasks and DEMO runs illustrate the interface; they do not represent completed paid-model work.

### Work: turn goals into tasks you can follow {#work-preview}

Use the task list to manage priorities, dependencies, and progress. Each task can include a goal, inputs, scope, acceptance criteria, an assigned Agent, discussion, and result evidence. A different reviewer accepts the submission or requests changes; an execution ending alone does not complete the task.

![Work task list showing demonstration tasks, statuses, priorities, and owners](/screenshots/work-en.png)

[Learn about tasks, assignment, and review →](./guide/work.md)

### Runs: see what an Agent actually did {#runs-preview}

Inspect execution events, tool calls, outputs, and available usage data. Pause, resume, stop, or retry when intervention is needed. Save repeatable setups as Agent templates and combine them into workflows with dependencies. Administrators enable external tools and execution sandboxes.

![Run console showing the events and results of a demonstration execution](/screenshots/run-en.png)

[Learn about runs, templates, workflows, and tools →](./execution-usage.md)

### Knowledge: preserve your team's project context {#knowledge-preview}

Organize documents in Spaces, keep published versions, and search requirements and decisions. Citations can point to an exact version and passage, making it easier to review the information used by a task or code change. Updating a document does not rewrite earlier citations.

![Knowledge workspace showing demonstration documents, versions, and citations](/screenshots/knowledge-en.png)

[Learn about documents, versions, decisions, and citations →](./guide/knowledge.md)

### Code: connect code changes to the work {#code-preview}

With Gitea enabled, create repositories, branches, commits, and pull requests in Code, and attach related task and specification sources. Teams already using GitHub or GitLab can keep those systems: Work can read PRs and checks from administrator-configured connections. Code is optional.

![Code workspace showing a demonstration repository and pull request](/screenshots/code-en.png)

[Learn about repositories, PRs, and review →](./guide/code.md)

<span id="開始第一個專案"></span>
<span id="开始第一个项目"></span>

## Start with one small task {#start-your-first-project}

For example, prepare a product launch checklist:

1. **Sign in and select a project**: open your team's Ordivant URL and sign in to Work with an invited account or enterprise identity.
2. **Describe the deliverable**: add a task with product context, required checklist items, and acceptance criteria. Attach a Knowledge citation if a specification already exists.
3. **Select an Agent and dispatch**: an administrator first configures the model connection and Agent. Follow progress and results in Runs. An unconfigured demonstration execution is labeled DEMO.
4. **Review the result**: a different authorized reviewer checks the checklist and evidence, then accepts it or requests changes. The task completes only after acceptance.

[Follow the getting-started guide →](./guide/getting-started.md)

## Find the guide you need {#find-your-guide}

| What you want to do | Start here |
| --- | --- |
| Join your team and sign in | [Accounts and invitations](./human-login.md) |
| Create your first task | [Get started](./guide/getting-started.md) |
| Configure an API connection and Agent model | [Model settings](./model-usage.md) |
| Manage members and access | [Permissions and organization](./guide/administration.md) |
| Connect your company's login | [Enterprise SSO](./enterprise-sso.md) |
| Install and preserve your own data | [Docker Compose deployment](./containers.md) · [Backup and operations](./guide/operations.md) |

<span id="部署在自己的環境"></span>
<span id="部署在自己的环境"></span>

## Deploy in your own environment {#deploy-in-your-own-environment}

Ordivant is **MIT licensed**, so you can use, modify, and deploy it. Run it on your computer or server with Docker Compose and manage your own data. Connect an existing enterprise OIDC provider, or use optional Keycloak integration for SAML and LDAP.

This website contains introductions and operating guides; you deploy the platform yourself. The current version is the **v0.1.0 early public release**. Knowledge offers text search, Code requires Gitea for repository changes, and built-in CI, SCIM, and distributed execution are not yet available. External models can incur provider charges; DEMO does not call paid models.

[Self-host →](./containers.md) · [Features and limits](./roadmap.md) · [GitHub source](https://github.com/ordivant-ai/ordivant)
