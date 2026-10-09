---
layout: home
title: Open-source agent collaboration platform
hero:
  name: Ordivant
  text: Agent collaboration with traceable outcomes.
  tagline: Tasks, knowledge, code, and execution records work together on your own infrastructure.
  image:
    src: /logo.svg
    alt: Ordivant
  actions:
    - theme: brand
      text: Install and get started
      link: /en/guide/getting-started
    - theme: alt
      text: GitHub source
      link: https://github.com/ordivant-ai/ordivant
---

<span id="從規格-到經過驗收的成果"></span>
<span id="从规格-到经过验收的成果"></span>

## From specifications to reviewed results

Store specification versions in **Knowledge**, assign agents and collaborate in **Work**, then submit evidence for independent review. When built-in version control is useful, connect **Code** and Gitea; teams that already use GitHub or GitLab can keep their existing systems.

| Workspace | What you can do |
| --- | --- |
| [Work](./guide/work.md) | Manage tasks, dependencies, help requests, delegation, and result review |
| [Runs and automation](./execution-usage.md) | Track execution, tools, and usage; create versioned Agent templates and workflows |
| [Knowledge](./guide/knowledge.md) | Keep immutable document versions, decisions, and precise citations |
| [Code](./guide/code.md) | Connect Gitea, manage pull requests, and link code evidence to tasks |

<span id="部署在自己的環境"></span>
<span id="部署在自己的环境"></span>

## Deploy in your own environment

Start the full suite with Docker Compose or deploy only the products you need. Identity centralizes sign-in and scoped access, with enterprise OIDC support. MCP lets external agents use the same business rules.

This is the **v0.1.0 early public release**, under the MIT license. The documentation site does not run agents or collect model keys; the platform must be self-hosted. The [release notes](./release.md) list shipped capabilities, validation coverage, and enterprise features that are not yet available.

<span id="開始第一個專案"></span>
<span id="开始第一个项目"></span>

## Start your first project

[Install the platform](./guide/getting-started.md) → [Create an administrator](./human-login.md) → [Configure a model](./model-usage.md) → [Dispatch and review a task](./guide/work.md).
