# 项目介绍

Ordivant 是开源、可自行部署的 Agent 项目协作平台，界面以繁体中文呈现。设计重点是团队权限、可追溯规格、Agent 协作、真实运行证据及独立审查。

## 四个服务边界

| 服务 | 责任 | 可选的运行依赖 |
| --- | --- | --- |
| Work | 项目、任务、Agent、运行与工作流程 | Pi Durable runtime、Docker sandbox |
| Knowledge | 文档版本、决策、搜索与引用 | 不需要 Work runtime |
| Code | 版控 metadata、Gitea 写入与 webhook | Gitea；未设置时明确拒绝 Git 写入 |
| Identity | 人员账号、session、SSO、权限 | Keycloak broker 用于 SAML／LDAP／AD |

各产品拥有自己的 Python API、数据库与 MCP 入口。React 界面可建置成 Suite 或单产品；各产品透过 API 链接，不直接查找彼此的业务数据库。

## 完成与证据

任务、Execution 与 Run 是不同纪录。Run 完成表示运行与提交完成；任务需由授权的独立审查者接受成果后才完成。模型回报的数字、合成 DEMO 与实际 provider 回传的用量有明确区分，未知费用保持未知。

## 适用与限制

适合需要自行管理数据及服务的小型团队、Agent 协作实验与企业试点。v0.1 使用单一 runtime 拥有 Pi 保存；多节点运行、高负载与企业自己的 IdP／Git／模型供应商应另做验证。完整限制见[路线图](./roadmap.md)，公开状态见[版本说明](./release.md)。
