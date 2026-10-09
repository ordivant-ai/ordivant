---
layout: home
title: 开源 Agent 协作平台
hero:
  name: Ordivant
  text: 让团队与 Agent 一起把工作完成。
  tagline: 安排任务与自动流程、整理项目知识、协作代码；看见每次运行，审查每份成果。
  image:
    src: /screenshots/work-zh-CN.png
    alt: Ordivant Work 任务工作区
  actions:
    - theme: brand
      text: 开始使用
      link: /zh-CN/guide/getting-started
    - theme: alt
      text: 自行部署
      link: /zh-CN/containers
---

<span id="從規格-到經過驗收的成果"></span>
<span id="从规格-到经过验收的成果"></span>

## 从规格，到经过验收的成果 {#from-specifications-to-reviewed-results}

Ordivant 是开源、可自行部署的 Agent 项目协作平台。你先说明要做的事、所需资料与验收条件，再把工作交给人员或 Agent；团队能查看进度、讨论问题、保存成果，最后由独立审查者确认完成。

**Work** 管理工作，**Knowledge** 保存知识，可选的 **Code** 处理代码协作。它们共用人员登录，但各自保留项目与权限；可以部署全套，也可以只选需要的产品。

## 哪些工作适合交给 Ordivant？ {#use-cases}

- **产品与项目推进**：把上线目标拆成任务，安排负责人、前置依赖与验收条件，追踪哪些工作尚未完成。
- **团队文档与决策**：集中整理需求、操作文档与决策，引用特定文档版本，让下一位接手的人找得到依据。
- **Agent 协作与代码交付**：让 Agent 按指定模型与工具运行，查看 Run 记录，把文档或 PR 作为成果交给审查者。

## 一次看懂主要功能 {#product-tour}

下列画面来自实际平台的示范工作区。示范任务及 DEMO Run 用于说明操作，不代表付费模型已完成工作。

### Work：把目标变成可以追踪的任务 {#work-preview}

用任务清单管理优先顺序、依赖与进度。每张任务可写入目标、输入资料、运行范围与验收条件，指派 Agent，保留讨论及成果证据。提交后由不同的审查者接受或退回，避免只凭“运行结束”就算完成。

![Work 任务清单：查看示范项目的状态、优先顺序与负责人](/screenshots/work-zh-CN.png)

[了解任务创建、指派与审查 →](./guide/work.md)

### Run：看见 Agent 做了什么 {#runs-preview}

从 Run 查看运行事件、工具调用、产出与可取得的用量。需要介入时可暂停、继续、停止或重试；常用做法可保存为 Agent 模板，再组成具有依赖的自动工作流程。外部工具连接与运行沙箱由管理者启用。

![Run 控制台：查看示范运行的事件与成果](/screenshots/run-zh-CN.png)

[了解 Run、模板、工作流程与工具 →](./execution-usage.md)

### Knowledge：保存团队共用的项目背景 {#knowledge-preview}

用 Space 组织文档，保留每次发布的版本，搜索规格与决策。引用可指向特定版本和段落，方便任务或代码审查回查当时使用的资料；更新文档不会改写先前的引用。

![Knowledge 工作区：查看示范文档、版本与引用](/screenshots/knowledge-zh-CN.png)

[了解文档、版本、决策与引用 →](./guide/knowledge.md)

### Code：把代码变更连回工作 {#code-preview}

启用 Gitea 后，在 Code 创建 repository、分支、commit 与 Pull Request，附上相关任务和规格来源。团队已有 GitHub 或 GitLab 时，也可沿用既有版本控制；Work 能读取管理者已设置的 PR 与检查结果，Code 并非必要服务。

![Code 工作区：查看示范 repository 与 Pull Request](/screenshots/code-zh-CN.png)

[了解 repository、PR 与审查 →](./guide/code.md)

<span id="開始第一個專案"></span>
<span id="开始第一个项目"></span>

## 从一个小任务开始 {#start-your-first-project}

例如“整理产品上线清单”：

1. **登录并选择项目**：使用团队提供的 Ordivant 网址，以受邀账号或企业账号登录 Work。
2. **说明要交付什么**：新增任务，写明产品背景、必须涵盖的项目与验收条件；已有规格时，加入 Knowledge 引用。
3. **选择 Agent 并派发**：管理者先设置模型连接及 Agent。派发后，在 Run 查看进度与成果；未设置模型的示范运行会标示 DEMO。
4. **审查成果**：由另一位获授权的审查者检查清单与证据，接受成果或退回修改。只有审查接受后，任务才算完成。

[跟着入门指南操作 →](./guide/getting-started.md)

## 找到你需要的操作指南 {#find-your-guide}

| 想做的事 | 从这里开始 |
| --- | --- |
| 加入团队、登录平台 | [账号与邀请](./human-login.md) |
| 创建第一个任务 | [开始使用](./guide/getting-started.md) |
| 设置 API 连接与 Agent 模型 | [模型设置](./model-usage.md) |
| 管理成员与访问权 | [权限与组织管理](./guide/administration.md) |
| 连接公司登录 | [企业 SSO](./enterprise-sso.md) |
| 安装与保存自己的数据 | [Docker Compose 部署](./containers.md)・[备份与运维](./guide/operations.md) |

<span id="部署在自己的環境"></span>
<span id="部署在自己的环境"></span>

## 部署在自己的环境 {#deploy-in-your-own-environment}

Ordivant 采用 **MIT 许可**，可以自行使用、修改及部署。用 Docker Compose 在自己的电脑或服务器启动，数据由你管理；企业可连接现有 OIDC 身份服务，或通过可选的 Keycloak 整合 SAML／LDAP。

这个网站是介绍及操作文档，平台需自行部署。现阶段为 **v0.1.0 早期公开版**；Knowledge 提供文字搜索，Code 需要 Gitea 才能变更 repository，尚未提供内置 CI、SCIM 或分布式运行。选用外部模型可能产生供应商费用；DEMO 不调用付费模型。

[自行部署 →](./containers.md) · [功能与限制](./roadmap.md) · [GitHub 源代码](https://github.com/ordivant-ai/ordivant)
