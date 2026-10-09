<span id="code-獨立容器驗收"></span>
<span id="code-独立容器验收"></span>

# Code 独立容器验收 {#code-standalone-container-acceptance}

此验收确认 Ordivant Code 可用 production Compose 设置独立启动，Work、Knowledge 与 Pi runtime 均不属于此 QA project。验收器只检查已启动的 Compose project；不会创建、停止或删除容器与数据 volume。

<span id="啟動與執行"></span>
<span id="启动与运行"></span>

## 启动与运行 {#start-and-run}

在 repository 根目录以 PowerShell 运行：

```powershell
$env:ORDIVANT_WEB_PORT = '8091'
.\scripts\containers.ps1 -Products code -Seed -ProjectName ordivant-code-qa
$env:UV_CACHE_DIR = '.cache/uv'
uv run --project products/code/backend --no-sync python scripts/code_standalone_acceptance.py --project-name ordivant-code-qa
```

不加 `-WithGitea`，让服务以明确未设置 Gitea 的状态启动。验收结束后保留 QA containers 供查核；若需管理它们，`scripts/containers.ps1` 必须使用同一个 `-ProjectName`。

<span id="驗收內容"></span>
<span id="验收内容"></span>

## 验收内容 {#what-is-checked}

验收器要求该 Compose project 恰有五个 running services：`code-api`、`code-db`、`web`、`identity-api` 与 `identity-db`。登录服务须健康，且首次设置尚未由测试初始化。它会检查 web root 加载的是只含 Code workspace 的 production bundle，并透过 `/api/health` 确认产品为 Code、数据库为 PostgreSQL、mode 为 production，且 `gitea_configured` 为 `false`。

它会从 Code API container 读取 seed bootstrap 至进程内存，检查 production local-session 回应 `403`、manager 可见两个 seed projects、writer 与 reader 只看得到 primary project、writer 无法读取 isolated project，以及 reader 创建 project 回应 `403`。manager 会创建一个具唯一 key 的验收 project；只有这项真实 project 写入必须成功并在只重启 `code-api` 后仍可读取。

验收也会尝试创建 repository，并要求未设置 Gitea 时回应 `503` 与 `gitea_not_configured`。此结果代表 Git repository、branch、commit、pull request 和 status 操作仍不可用；不得将 metadata project 创建解读为 Git 写入成功。最后会在 Code API container 内启动 official MCP SDK stdio client，精确比对九个 tools，并透过 `list_repositories` 与 `get_code_events` 对 Code REST service 运行唯读 round trip。

JSON report 写在被忽略的 `.data/validation/standalone-code-.../report.json`，并输出各项 check 与第一个失败 predicate。bootstrap token 不会加入 report 或诊断输出。最终 readiness 无论前段检查是否成功都会运行。
