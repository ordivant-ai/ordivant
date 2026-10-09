<span id="維運與備份"></span>
<span id="运维与备份"></span>

# 运维与备份 {#operations-and-backups}

本地与容器服务的生命周期由 `scripts/containers.ps1` 控制。初次操作请指定固定的 `-ProjectName`；此脚本按该名称隔离 Compose 项目、具名数据卷及 `.data/container-secrets/<ProjectName>`。从另一份 Git 工作副本启动时，必须明确使用相同名称，才能连接到原有数据。

<span id="服務狀態與更新"></span>
<span id="服务状态与更新"></span>

## 服务状态与更新 {#service-status-and-updates}

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action status
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action logs -WithRuntime -WithGitea -WithSandbox
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev
```

每次调用脚本时，都要使用相同的开发或生产模式及项目名称。查看 `logs` 时，加入要检查的可选服务配置文件参数；`down` 会一并处理已启用的可选配置文件，并停止该 Compose 项目。它会保留数据卷和机密文件，但不等于备份。删除 Compose 项目的数据卷会永久删除该项目的数据。

开发版 Web 默认只监听本地环回地址（loopback）的 `5173` 端口；Gitea 默认使用 `3002`。若主机端口冲突，可分别设置 `ORDIVANT_DEV_WEB_PORT` 和 `ORDIVANT_GITEA_PORT`。开发脚本也会让 API 端口仅监听本地环回地址。生产版 Web 默认使用 `8088`；对外部署时，请自行设置 HTTPS 反向代理、正式网站来源及安全 Cookie。

<span id="需要備份的資料"></span>
<span id="需要备份的数据"></span>

## 需要备份的数据 {#data-to-back-up}

备份时以 Compose project label 找出该环境的所有 volumes，依数据库产品与 data volume 作为同一组保存。典型完整套件包含：

| 区域 | Compose 数据卷／主机文件 | 内容 |
|---|---|---|
| Identity | `identity_postgres`、`identity_data` | 人员、会话、SSO 设置与 `sso.key` |
| Work | `work_postgres`、`work_data` | Work 任务、Agent、Run、Runtime 状态及 `model-settings.key` |
| Knowledge | `knowledge_postgres`、`knowledge_data` | Space 文档版本、决策与范围数据 |
| Code | `code_postgres`、`code_data` | Code 范围、repository 绑定、PR 与状态收据 |
| Gitea（若启用） | `gitea_data` | Repository、分支、提交、PR 的实际 Git 数据 |
| Keycloak broker（若激活） | `identity_broker_postgres` | Broker realm 与连接设置 |
| Compose 机密 | `.data/container-secrets/<ProjectName>/` | 数据库密码／URL、内部服务 token、Gitea 与其他服务设置 |

实际数据卷清单会依启用的产品和配置文件而异。Work 的 `model-settings.key` 用于解密模型及 MCP 工具连接设置；Identity 的 `sso.key` 用于解密企业 IdP 设置。加密密钥必须与对应数据库和数据卷一起备份，不可单独更换，否则无法解密已有密文。Runtime 的 Pi 状态位于 Work 数据卷。每次 sandbox 的工作目录都是临时数据，不是成果保存位置。

在 Docker Desktop 或 Docker CLI 中，可用 Compose 项目标记查出此环境实际创建的数据卷名称：

```powershell
docker volume ls --filter "label=com.docker.compose.project=ordivant-dev"
```

请将列出的所有产品、Identity 及已启用配置文件的数据卷纳入备份；实际清单以此命令结果为准，不要只依范例名称猜测。

<span id="一致性與還原"></span>
<span id="一致性与还原"></span>

## 一致性与还原 {#consistency-and-restoration}

1. 确认备份目标是正确的 Compose 项目名称。使用 `-Action down` 停止该环境，让文件数据与 PostgreSQL 数据卷保持一致；这不会删除数据。
2. 使用组织核准的 Docker 数据卷快照或备份工具，备份该项目标记下需要的全部数据卷。也要一并保存同一项目中被 Git 忽略的 `container-secrets` 目录。
3. 将备份和主机上的机密目录加密保存、限制访问，并定期测试还原。不要把 `.data`、初始设置 token 或 Gitea／服务凭证上传到公开 issue、聊天或 Git。
4. 还原时先恢复同名 Compose 数据卷及原有机密，再使用相同项目名称与原产品／配置文件启动。不要混用不同环境的加密密钥和数据库。

若使用单一产品或部分产品模式，请备份该模式创建的所有数据卷及共用 Identity 数据卷。Knowledge 引用和 Code PR 的来源追溯信息不能代替目标产品数据备份；也需保存来源产品及实际 Gitea 数据。

<span id="執行與排程"></span>
<span id="运行与调度"></span>

## 运行与调度 {#execution-and-scheduling}

定期间隔工作流程需要 Work Runtime 持续运行。服务停止期间错过的计划不会全部补跑；同一计划已有进行中的工作流程时，不会重叠启动。每次沙箱工作区都有资源限制，并在 Run 结束时清理，不应用来长期保存文件。Run、成果物和 Knowledge 文档请通过相应产品保存。

运行控制、工具允许连接的主机及沙箱限制见[运行使用指南](../execution-usage.md)。Runtime 未设置有效模型时会使用 DEMO 后备模式；DEMO 不代表付费模型运行，也不是费率估算。
