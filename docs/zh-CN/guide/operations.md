# 运维与备份

本机与容器的服务生命周期由 `scripts/containers.ps1` 控制。第一次操作时指定稳定的 `-ProjectName`；helper 以该名称隔离 Compose project、named volumes 和 `.data/container-secrets/<ProjectName>`。从另一个 clone 启动时，明确使用同一个名称才能找到原数据。

## 服务状态与更新

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action status
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action logs -WithRuntime -WithGitea -WithSandbox
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev
```

每次需以相同的 Development／production 模式和 project name 调用 helper。查看 `logs` 时，带上要检查的 optional profile 选项；`down` 会纳入 optional profiles 并停止该 Compose project。它保留 volumes 和 secret files，不是备份。删除 Compose project volumes 会永久删除该 project 的数据。

开发 Web 预设绑定 loopback `5173`，Gitea 预设 `3002`；可分别用 `ORDIVANT_DEV_WEB_PORT` 和 `ORDIVANT_GITEA_PORT` 避开主机 port 冲突。开发 helper 预设也只把其 API ports 绑定 loopback。Production Web 预设 `8088`，对外部署需自行配置 HTTPS reverse proxy、canonical origin 和 secure cookies。

## 需要备份的数据

备份时以 Compose project label 找出该环境的所有 volumes，依数据库产品与 data volume 作为同一组保存。典型完整套件包含：

| 区域 | Compose volumes / host files | 内容 |
|---|---|---|
| Identity | `identity_postgres`、`identity_data` | 人员、session、SSO 设置与 `sso.key` |
| Work | `work_postgres`、`work_data` | Work 任务、Agent、Run、Runtime 状态及 `model-settings.key` |
| Knowledge | `knowledge_postgres`、`knowledge_data` | Space、文档版本、决策与范围数据 |
| Code | `code_postgres`、`code_data` | Code scopes、Repository binding、PR 和 status receipts |
| Gitea（若激活） | `gitea_data` | Repository、branch、commit、PR 的实际 Git 数据 |
| Keycloak broker（若激活） | `identity_broker_postgres` | Broker realm 与连接设置 |
| Compose secrets | `.data/container-secrets/<ProjectName>/` | DB password/URL、内部服务 token、Gitea 与其他服务设置 |

实际 volume 清单依激活产品和 profiles 而异。Work 的 `model-settings.key` 用于解密模型和 MCP tool connection 设置；Identity 的 `sso.key` 用于解密企业 IdP 设置。加密 key 必须与对应数据库、data volume 一起备份，不能单独换新，否则旧密文无法解密。Runtime 的 Pi 状态位于 Work data volume。每次 sandbox 的工作目录是暂时数据，不作为成果保存位置。

在 Docker Desktop 或 Docker CLI 中，可用 project label 找到这个环境实际创建的 volume 名称：

```powershell
docker volume ls --filter "label=com.docker.compose.project=ordivant-dev"
```

将列出的所有产品、Identity 和已激活 profile volumes 纳入备份；实际清单以此命令结果为准，不要只依照范例名称猜测。

## 一致性与还原

1. 确认备份目标是正确的 Compose project name。用 `-Action down` 停止该环境，让文件与 PostgreSQL volume 保持一致；这不会删除数据。
2. 使用你组织核准的 Docker volume snapshot／备份工具，备份该 project label 下需要的全部 volumes。也一并保存同 project 的 ignored `container-secrets` 目录。
3. 将备份与 host secrets 目录加密保存，限制访问并定期测试还原。不要把 `.data`、bootstrap token 或 Gitea/service credential 上传到公开 issue、聊天或 Git。
4. 还原时先恢复同名 Compose volumes 和原 secrets，再使用同一 project name 与原产品/profile 启动。不要将不同环境的加密 key 和数据库混用。

若使用单产品或部分产品模式，备份该模式创建的所有 volumes 及共用 Identity volumes。Knowledge 引用和 Code PR provenance 不会代替目的产品数据备份；需一并保存来源产品及实际 Gitea 数据。

## 运行与调度

Interval workflow 需要 Work Runtime 持续运行。停止期间错过的调度不会全部补跑；同一调度的 active workflow 会阻止重叠。每次沙箱 workspace 都有界限并在 Run 结束清理，不应用作持久文件保存。Run、artifact 和 Knowledge 文档要透过产品本身保存。

运行控制、允许工具 host 和沙箱限制见[运行使用指南](../execution-usage.md)。Runtime 未配置有效模型时使用 DEMO fallback；DEMO 不是付费模型或费率估算。
