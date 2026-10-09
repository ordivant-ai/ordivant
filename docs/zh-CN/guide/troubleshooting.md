<span id="排除常見問題"></span>
<span id="排除常见问题"></span>

# 排除常见问题 {#troubleshooting}

<span id="啟動與登入"></span>
<span id="启动与登录"></span>

## 启动与登录 {#startup-and-sign-in}

| 现象 | 原因或检查方式 | 处理方式 |
|---|---|---|
| helper 找不到 Docker Compose | Docker Desktop／Docker Engine 未启动，或 Compose v2 未安装 | 确认可运行 `docker compose version`，并使用 Docker Desktop 的 Linux containers。 |
| PowerShell 指令无法识别 | 调用到 Windows PowerShell 而非 PowerShell 7 | 安装／启动 `pwsh`，并从 repository root 运行 `scripts/containers.ps1`。Linux 路径使用斜线。 |
| 服务启动时 port 已被使用 | 另一个本机进程或 Compose project 占用 port | 使用环境变量调整对应 port，例如 `ORDIVANT_DEV_WEB_PORT` 或 `ORDIVANT_GITEA_PORT`，再以相同 project name 重启。 |
| 页面显示 API 无法连接 | API 尚未健康，映像仍在建置，或选到不同 Compose project | 等待 helper 完成；运行 `-Action status` 检查服务，再用相同 project name 和已激活 profiles 运行 `-Action logs`。 |
| 没看到创建管理员的初始设置 | 此 Identity volume 已初始化，或目前指向另一个 Compose project | 核对 `-ProjectName` 和 `-Development` 模式。没有预设账号；请使用既有管理员或复原流程，不要删除 volume 来试密码。 |
| 登录成功但看不到 Project／Space | 人类 session 已创建，但该产品资源范围尚未授予 | 请 Identity 管理员分配正确产品角色及明确资源 scope。SSO 网域不会自动授予数据访问权。 |

<span id="seed、runtime-與-run"></span>
<span id="seed、runtime-与-run"></span>

## Seed、Runtime 与 Run {#seed-runtime-and-runs}

| 现象 | 原因或检查方式 | 处理方式 |
|---|---|---|
| Runtime 启动提示找不到 Work bootstrap | 新 Work volume 尚未使用 `-Seed` 创建 bootstrap；Runtime 不会自行生数据 | 在全新 DEMO 环境明确加 `-Seed` 启动一次，再以相同 project 加入 `-WithRuntime`。若已有正式数据，先确认备份与正确数据目录，不要随意 seed。 |
| 看不到示范任务 | Seed 是明确选项，或启动时只选了部分产品 | 确认 `-Products` 选择和正确 project。只有要创建 DEMO 时才明确使用 `-Seed`。 |
| Run 停留在 queued/waiting | Runtime 未启动、Agent 不符合能力／scope、前置 Task 尚未被接受，或没有可用 Agent | 确认 Work Runtime 健康；检查 Agent 的角色、Project scope、能力和 workflow dependency/review 状态。 |
| 运行结果标示 DEMO | 尚未为组织或 Agent 配置有效的模型连接 | 由管理员在 Work 设置供应商 endpoint/key 和 model，再设置 Agent 继承或个别覆写。DEMO 不代表已使用付费模型。 |
| Stop 后上游工具结果不明 | Stop 会撤销 Run 写入权；外部服务可能已运行副作用 | 先到该上游服务核对实际结果，再决定是否创建新 Run。系统不会自动重播不确定的外部操作。 |

<span id="knowledge、code-與-sso"></span>
<span id="knowledge、code-与-sso"></span>

## Knowledge、Code 与 SSO {#knowledge-code-and-sso}

| 现象 | 原因或检查方式 | 处理方式 |
|---|---|---|
| Knowledge 搜索找不到语意相近的内容 | 目前是标题／正文文字搜索，非矢量或 RAG 搜索 | 使用正文确切词汇、文档标题或 tag 筛选；确认有读取该 Space 的权限。 |
| 发布 Knowledge 版本回报冲突 | 预期版本已被其他 writer 更新 | 加载最新版本，检查变更和引用，再基于最新版本重新编辑、发布。既有版本不会被覆写。 |
| Code 可读但不能创建 repository／PR | Gitea profile 未启动或 Code API 未连接 Gitea | 使用 `-WithGitea` 启动相同 development Compose project，等待健康检查后在 Code 重试。不要把 Gitea service credential 放入浏览器。 |
| PR 有 status 但无法确认测试曾运行 | `agent_reported` 是提交状态收据，不是 CI runner 运行记录 | 检查收据来源；只有实际可验证的 Gitea webhook 或外部测试系统才代表其对应事件，不要把回报写成 CI 结果。 |
| OIDC callback 或登录循环失败 | IdP Redirect URI 与管理界面显示的 Callback URL 不完全一致，或 canonical HTTPS origin／cookie 设置不符 | 核对完整 callback URL、Issuer、允许网域及可信 public origin；先用一位成员验证再改登录政策。设置步骤见[企业登录说明](../enterprise-sso.md)。 |

<span id="資料與服務目錄"></span>
<span id="数据与服务目录"></span>

## 数据与服务目录 {#data-and-service-directories}

- 如果换了 clone 路径后数据看起来消失，helper 的预设 Compose project 名称可能不同。启动时固定使用 `-ProjectName`，并用同一名称管理 status/logs/down。
- `-Action down` 保留数据；再次运行 `docker compose down -v` 会移除 volumes，造成数据遗失。不要将 volume 清除当成一般排障步骤。
- 不要直接把 `.data/container-secrets`、bootstrap 档、IdP client secret 或 Gitea 设置贴到日志或 issue。helper 的 logs 输出会遮罩已知服务 secrets；仍需先检查输出再公开分享。
- 备份需包含数据库、data volumes 和对应 encryption keys。操作步骤见[运维与备份](operations.md)。
- Work/Knowledge/Code 各自有服务与数据边界；一个产品健康不代表其他产品也可用。先查看产品自身 health/status，再检查共用 Identity 或依赖服务。
