# Ordivant

[繁體中文](README.md) · **简体中文** · [English](README.en.md)

**开源、自行部署的 Agent 协作平台。** 将任务、知识、代码与执行证据串成可独立审查的工作流程。

面向 Agent 的自托管协作：项目、版本化知识、代码溯源、持久运行与独立审查。应用和文档支持繁体中文、简体中文与 English。

[文档与安装指南](https://ordivant-ai.github.io/zh-CN/) · [版本下载](https://github.com/ordivant-ai/ordivant/releases) · [问题反馈](https://github.com/ordivant-ai/ordivant/issues) · [MIT 许可](LICENSE)

[![CI](https://github.com/ordivant-ai/ordivant/actions/workflows/ci.yml/badge.svg)](https://github.com/ordivant-ai/ordivant/actions/workflows/ci.yml)
[![Docs](https://github.com/ordivant-ai/ordivant/actions/workflows/pages.yml/badge.svg)](https://github.com/ordivant-ai/ordivant/actions/workflows/pages.yml)

## 功能

| 产品 | 能力 |
| --- | --- |
| **Work** | 项目与任务、Agent 认领／求助／委派、证据提交、独立审查、REST/MCP、审计 |
| **Run 与自动化** | Pi Durable 执行、事件／工具／用量、暂停／继续／停止／重跑、版本化模板与依赖流程 |
| **Knowledge** | 不可变文档版本、文本检索、精确引用、决策与来源追溯 |
| **Code** | 可选 Gitea 仓库、分支、commit、PR、status receipt 与签名 webhook |
| **Identity** | 原生账号、session、邀请／恢复、资源权限、企业 OIDC 与可选 SAML/LDAP broker |

Work 可直接读取已配置的 GitHub、GitLab 或 Gitea；Code 是可选产品。各产品拥有独立 API、MCP 接口和数据库，可部署完整 Suite 或单个产品与 Identity。

## 快速开始

需要 **Git、支持 Linux 容器的 Docker、Compose v2 和 PowerShell 7**。Windows 可使用 Docker Desktop；Linux/macOS 安装 `pwsh` 后使用相同 helper。应用依赖均在容器内安装，主机不需要 Python 或 Node。

```powershell
git clone https://github.com/ordivant-ai/ordivant.git
cd ordivant
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -Seed -WithRuntime -WithSandbox
```

打开 **http://127.0.0.1:8088/work** 并创建自己的首位管理员。没有默认人员密码。`-Seed` 会创建明确标注的 DEMO 数据以及首次启动 Runtime 所需的 bootstrap。没有配置模型时不会调用付费模型。

登录后，在 **模型连接** 中配置 Responses-compatible provider、API key 和 model，再创建 Pi Agent 并派发任务。Work 会加密保存密钥；模板不保存密钥。Run 提交后仍须由独立 reviewer 验收。

```powershell
# 查看状态；down 会停止此项目但保留数据卷。重启时使用相同 ProjectName。
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -Action status
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -Action down
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-local -WithRuntime -WithSandbox

# 开发模式：source 热重载，默认端口 5173；使用独立项目名和数据。
pwsh -File ./scripts/containers.ps1 -Development -ProjectName ordivant-dev -Seed -WithRuntime -WithSandbox

# 只启动 Knowledge、Identity 和 Web；不需要 Runtime。
pwsh -File ./scripts/containers.ps1 -ProjectName ordivant-knowledge -Products knowledge -Seed
```

以上 production 示例共用默认端口 `8088`，应依序运行。若要同时启动多个项目，请为各项目设置不同的 `ORDIVANT_WEB_PORT`。需要本地 forge 时加上 `-WithGitea`。全新安装、模型、账号与完整示例见[入门指南](docs/zh-CN/guide/getting-started.md)。GitHub Pages 是静态文档站，平台需自行部署。

## 语言

可在登录页及产品导航下方切换**繁体中文、简体中文与 English**。选择保存在当前浏览器，并在 Work、Knowledge 与 Code 间同步；切换语言不会清除表单。用户创建的任务、文档、消息与代码会保留原文。文档站右上角可切换同一篇文章的语言。详见[语言与翻译](docs/zh-CN/i18n.md)。

## 文档

| 开始与操作 | 管理与开发 |
| --- | --- |
| [Work 任务协作](docs/zh-CN/guide/work.md) | [Docker 开发／部署](docs/zh-CN/containers.md) |
| [Run、工作流程、工具与沙箱](docs/zh-CN/execution-usage.md) | [管理员与权限](docs/zh-CN/guide/administration.md) |
| [Knowledge 与精确引用](docs/zh-CN/guide/knowledge.md) | [账号与登录](docs/zh-CN/human-login.md)／[企业 SSO](docs/zh-CN/enterprise-sso.md) |
| [Code 与版本控制](docs/zh-CN/guide/code.md) | [备份与运维](docs/zh-CN/guide/operations.md)／[问题排查](docs/zh-CN/guide/troubleshooting.md) |
| [模型连接](docs/zh-CN/model-usage.md) | [架构／API 契约](docs/zh-CN/reference.md)／[贡献指南](CONTRIBUTING.md) |

## 版本与边界

当前版本为 **v0.1.0 早期公开版**。工作流程支持 DAG、手动启动和分钟间隔排程；暂停在工具边界生效。MCP 连接使用 Streamable HTTP/Bearer。Docker 沙箱无网络、以非 root 运行、没有主机挂载或凭证，并与主机共享 kernel。只有受信任的 `sandbox-api` 持有 Docker socket。

Knowledge 使用文本搜索；Code status receipt 不代表内置 CI。尚未提供 SCIM、硬性金额配额、交互式 MCP OAuth、VM 沙箱或分布式执行。企业自己的 IdP、Git、模型和运维环境需另行验收。详见[路线图](docs/zh-CN/roadmap.md)、[版本说明](CHANGELOG.md)与[安全政策](SECURITY.md)。

## 开发与验证

Python 3.12（由 uv 管理）、Node.js 24、React/TypeScript/Ant Design、FastAPI、PostgreSQL、Pi Durable。源代码位于 `backend/`、`frontend/`、`runtime/`、`sandbox/` 与 `products/{identity,knowledge,code}/backend/`。

```powershell
# 本机开发依赖与离线／合成验证
pwsh -File ./scripts/setup.ps1 -SkipSeed
pwsh -File ./scripts/validate.ps1

# 文档站
npm ci --prefix docs
npm run build --prefix docs
npm run preview --prefix docs
```

CI 不需要付费模型密钥。付费 Live 验收需明确 opt-in，并使用隔离 QA 和自己指定的 credential 文件。本机历史模型／Docker／浏览器验收摘要见[验收记录](docs/zh-CN/validation.md)；私有 `.data/` 与原始 QA 数据不会随仓库发布。

欢迎提交 issue 与 PR；请先阅读 [CONTRIBUTING](CONTRIBUTING.md)。漏洞请通过[私密安全通告](https://github.com/ordivant-ai/ordivant/security/advisories/new)回报。Ordivant 源代码采用 [MIT](LICENSE) 许可；第三方软件包与可选服务保留各自许可，详见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。
