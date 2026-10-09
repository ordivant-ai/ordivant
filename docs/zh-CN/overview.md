<span id="專案介紹"></span>
<span id="项目介绍"></span>

# 项目介绍 {#project-overview}

Ordivant 是开源、可自行部署的 Agent 项目协作平台，界面以繁体中文呈现。设计重点是团队权限、可追溯规格、Agent 协作、真实运行证据及独立审查。

<span id="四個服務邊界"></span>
<span id="四个服务边界"></span>

## 四个服务边界 {#four-service-boundaries}

| 服务 | 责任 | 可选的运行依赖 |
| --- | --- | --- |
| Work | 项目、任务、Agent、运行与工作流程 | Pi Durable 运行环境、Docker 沙箱 |
| Knowledge | 文档版本、决策、搜索与引用 | 不需要 Work runtime |
| Code | 版本控制元数据、Gitea 写入与 webhook | Gitea；未设置时明确拒绝 Git 写入 |
| Identity | 人员账号、session、SSO、权限 | Keycloak broker 用于 SAML／LDAP／AD |

各产品都有自己的 Python API、数据库与 MCP 入口。React 界面可构建为 Suite 或单个产品；各产品通过 API 连接，不会直接查询彼此的业务数据库。

<span id="完成與證據"></span>
<span id="完成与证据"></span>

## 完成与证据 {#completion-and-evidence}

任务、Execution 与 Run 是不同记录。Run 完成表示运行与提交完成；任务需由获授权的独立审查者接受成果后才算完成。模型自报的成本、合成 DEMO 与实际 Provider 返回的用量会明确区分；未知费用仍标示为未知。

<span id="適用與限制"></span>
<span id="适用与限制"></span>

## 适用与限制 {#intended-use-and-limits}

适合需要自行管理数据及服务的小型团队、Agent 协作实验与企业试点。v0.1 由单一 runtime 拥有 Pi 存储；多节点运行、高负载，以及各企业自己的 IdP／Git／模型供应商都应另行验证。完整限制见[路线图](./roadmap.md)，公开状态见[版本说明](./release.md)。
