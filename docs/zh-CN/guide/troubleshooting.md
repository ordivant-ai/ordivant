<span id="排除常見問題"></span>
<span id="排除常见问题"></span>

# 排除常见问题 {#troubleshooting}

<span id="啟動與登入"></span>
<span id="启动与登录"></span>

## 启动与登录 {#startup-and-sign-in}

| 现象 | 原因或检查方式 | 处理方式 |
|---|---|---|
| Docker Compose 无法启动 | Docker Engine 未运行，或 Compose v2 未安装 | 确认 `docker compose version` 可以正常运行，并启动 Docker Desktop 或 Docker Engine。 |
| 服务启动时 port 已被使用 | 另一个本机进程占用了 port | 在 repository root 的 `.env` 中调整 `ORDIVANT_WEB_PORT` 或 `ORDIVANT_GITEA_PORT`，再使用相同部署名称和 profiles 启动。 |
| 页面显示 API 无法连接 | API 尚未健康、映像仍在构建，或选到了不同的 Compose project | 在 repository root 运行 `docker compose ps` 和 `docker compose logs --tail 100 work-api`。确认部署名称、profiles 和 Compose 文件组合相同。 |
| 没看到创建管理员的初始设置 | Identity 数据卷已初始化，或目前指向另一个 Compose project | 运行 `docker compose ls`；默认部署名称由 `compose.yaml` 设为 `ordivant`。只有自定义名称时才核对 repository root 的 `.env` 中的 `COMPOSE_PROJECT_NAME`。没有预设账号；请使用现有管理员或恢复流程，不要删除 volume 来试密码。 |
| 登录成功但看不到 Project／Space | 人类 session 已创建，但该产品资源范围尚未授予 | 请 Identity 管理员分配正确产品角色及明确资源 scope。SSO 网域不会自动授予数据访问权。 |

<span id="seed、runtime-與-run"></span>
<span id="seed、runtime-与-run"></span>

## Runtime 与模型设置 {#seed-runtime-and-runs}

| 现象 | 原因或检查方式 | 处理方式 |
|---|---|---|
| Runtime 因机器身份尚未初始化而无法启动 | Work API 尚未健康，或 Runtime bootstrap 尚未完成 | 启动 Work API 后运行 `docker compose exec work-api python -m ordivant.bootstrap_runtime` 和 `docker compose --profile runtime up -d --build --wait runtime`。此操作不需要 Seed，也不会创建人员或项目；已有有效的 `runtime_token` 不会被轮换。 |
| 看不到 DEMO 示例 | Seed 是可选项；全新环境默认没有 DEMO 数据 | 只有没有任何真实数据的全新试用环境，才可在 Runtime bootstrap 前创建 DEMO。请从[运维与备份](operations.md)选择一个产品的 Seed 命令。既有部署不可执行 Seed。 |
| Run 停留在 queued/waiting | Runtime 未启动、Agent 不符合能力／scope、前置 Task 尚未被接受，或没有可用 Agent | 运行 `docker compose --profile runtime ps` 和 `docker compose --profile runtime logs --tail 100 runtime`。检查 Agent 的角色、Project scope、能力及 workflow dependency/review 状态。启用 Sandbox 时，也要使用相同的 `-f compose.yaml -f compose.sandbox.yaml` 文件。 |
| 运行结果标示 DEMO | 尚未为组织或 Agent 配置有效的模型连接 | 管理员在 Work 模型管理页设置 provider、API key 和 model，确认 Agent 设置后重新派发 Run。DEMO 不代表已使用付费模型。 |
| Stop 后上游工具结果不明 | Stop 会撤销 Run 写入权；外部服务可能已运行副作用 | 先到该上游服务核对实际结果，再决定是否创建新 Run。系统不会自动重播不确定的外部操作。 |

<span id="knowledge、code-與-sso"></span>
<span id="knowledge、code-与-sso"></span>

## Knowledge、Code 与 SSO {#knowledge-code-and-sso}

| 现象 | 原因或检查方式 | 处理方式 |
|---|---|---|
| Knowledge 搜索找不到语意相近的内容 | 目前是标题／正文文字搜索，非矢量或 RAG 搜索 | 使用正文确切词汇、文档标题或 tag 筛选；确认有读取该 Space 的权限。 |
| 发布 Knowledge 版本回报冲突 | 预期版本已被其他 writer 更新 | 加载最新版本，检查变更和引用，再基于最新版本重新编辑、发布。既有版本不会被覆写。 |
| Code 可读但不能创建 repository／PR | Gitea profile 未启动、初始化未完成，或 Code API 尚未重新连接 Gitea | 按下方命令启动并初始化 Gitea，再重新创建 Code API。不要把 Gitea service credential 放入浏览器。 |
| PR 有 status 但无法确认测试曾运行 | `agent_reported` 是提交状态收据，不是 CI runner 运行记录 | 检查收据来源；只有实际可验证的 Gitea webhook 或外部测试系统才代表其对应事件，不要把回报写成 CI 结果。 |
| OIDC callback 或登录循环失败 | IdP Redirect URI 与管理界面显示的 Callback URL 不完全一致，或 canonical HTTPS origin／cookie 设置不符 | 核对完整 callback URL、Issuer、允许网域及可信 public origin；先用一位成员验证再改登录政策。设置步骤见[企业登录说明](../enterprise-sso.md)。 |

启用 Gitea 时，请在 repository root 使用相同的 Compose project 运行：

```sh
docker compose --profile gitea up -d --wait gitea
docker compose -f compose.yaml -f compose.gitea-init.yaml --profile gitea run --rm gitea-init
docker compose up -d --no-deps --force-recreate --wait code-api
```

<span id="資料與服務目錄"></span>
<span id="数据与服务目录"></span>

## 数据与服务目录 {#data-and-service-directories}

- 默认 Compose project 名称由 `compose.yaml` 固定为 `ordivant`。若使用自定义 `.env`，请确认 `COMPOSE_PROJECT_NAME` 与原部署相同；运行 `docker compose ls` 可查看已启动的项目。
- `docker compose down` 会保留数据；`docker compose down -v` 会移除 volumes 并造成数据丢失。不要把删除 volume 当成常规排障步骤。
- 不要把默认的 `.data/container-secrets/`、自定义 `ORDIVANT_SECRETS_DIR`、bootstrap 数据、IdP client secret 或 Gitea 设置贴到日志或 issue。分享 Docker logs 前也要先检查是否含有机密。
- 备份需包含数据库、data volumes 和对应 encryption keys。操作步骤见[运维与备份](operations.md)。
- Work/Knowledge/Code 各自有服务与数据边界；一个产品健康不代表其他产品也可用。先查看产品自身 health/status，再检查共用 Identity 或依赖服务。
- 启用 Sandbox 后，所有 Compose 命令都必须沿用安装时的 `-f compose.yaml -f compose.sandbox.yaml` 文件组合和相同 profiles。
