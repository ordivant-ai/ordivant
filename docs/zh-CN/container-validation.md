<span id="compose-容器驗收"></span>
<span id="compose-容器验收"></span>

# Compose 容器验收 {#compose-container-acceptance}

`scripts/container_acceptance.py` 验收由 `scripts/containers.ps1` 已启动的 Compose project。它不会运行 `up` 或 `down`，也不会删除 volumes。Development 验收会短暂停止同一 project 的 Knowledge 与 Code API，以确认 Work 对既有 VCS 的连接不依赖两个 peer，之后会在 `finally` 区段将它们启动；结尾会重启三个 API 并检查数据仍可读。

<span id="啟動-development"></span>
<span id="启动-development"></span>

## 启动 Development {#start-development-mode}

PowerShell：

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
./scripts/containers.ps1 -Action up -Development -Seed -WithGitea -WithRuntime -ProjectName ordivant-dev
```

请先确认 helper 显示 project ready，再运行：

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
uv run --project backend python scripts/container_acceptance.py --project-name ordivant-dev --development
```

Development 预设验收 Web `5173`、Work `8000`、Knowledge `8010`、Code `8020`、Pi runtime `8090`，并由 Compose 查找 Gitea loopback host port。可用 `--web-port`、`--work-port`、`--knowledge-port`、`--code-port`、`--runtime-port`、`--gitea-port` 或 helper 同名环境变量覆写。

脚本会从 `.data/container-secrets/<project>/gitea.json` 读取 Gitea 设置，确认 URL 指向 Compose 内网 `gitea:3000`；再透过 `docker compose exec -T <product>-api python -c ...` 截取各产品 `/data/bootstrap.json`。凭证只留在验收进程内存并传给现有 `scripts/suite_integration.py` flow；不会输出 bootstrap、Gitea token 或 webhook secret。

Development 检查包含：三个 API 使用 PostgreSQL 与 development mode；已接入 Identity，因此三个 local-session 经 Vite proxy 或直连 API 都回传 403；Knowledge immutable version/CAS、Work delegation/review、Code 真实 Gitea repo/branch/commits/PR/status/webhook、三产品 MCP SDK，以及已启动 runtime 的 Pi dispatch acceptance。接着脚本把 project-scoped `/data/vcs.json` 透过 `docker compose exec -T ... python -c ...` 的标准输入写入 Work data volume，停止 Knowledge/Code API，并在 peers 停止时验证 Work REST、MCP 和独立任务审查流程。完整的人员登录生命周期由 [登录验收](auth-validation.md) 的隔离环境检查。

完成后三个 API 会重启。脚本会再次确认 Work 已接受任务、Knowledge 已发布版本和 Code PR binding 均留存。若 `-WithRuntime` 未启动，报告会明确标记 runtime 为 skipped；需要完整 runtime gate 时请以该选项启动。

<span id="驗收-production"></span>
<span id="验收-production"></span>

## 验收 Production {#check-production-mode}

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
./scripts/containers.ps1 -Action up -Seed -WithGitea -ProjectName ordivant-prod
uv run --project backend python scripts/container_acceptance.py --project-name ordivant-prod
```

Production 验收经由 Web `8088`（或 `ORDIVANT_WEB_PORT`）检查 `/api`、`/knowledge-api`、`/code-api` 健康状态与 PostgreSQL；三个 local-session 必须全部回应 403。脚本会重启三个 API，等待 proxy health 恢复，再以各产品 bootstrap token 确认 Work seeded project、Knowledge primary space、Code project 仍可读。Production Compose 预设不公开 API 或 Pi runtime port，所以此模式不宣称完成 Development 的跨产品全流程、peer-stop 或 runtime acceptance。

Production 完整验收需以 `-WithRuntime` 启动既有 project，再加上 `--full-flow`：

```powershell
./scripts/containers.ps1 -Action up -Seed -WithGitea -WithRuntime -ProjectName ordivant-prod
uv run --project backend python scripts/container_acceptance.py --project-name ordivant-prod --full-flow
```

`--full-flow` 只验收已启动的 production project，不会运行 Compose `up` 或 `down`。它保留 production health、local-session 403 与 scoped seed reads，接着透过 Web proxy 运行既有 `suite_integration.py` REST/MCP/真实 Gitea 流程，再停止 Knowledge/Code API 验证 Work REST、MCP 与既有 VCS 工作流程。Pi Durable acceptance 在同 project 的 `work-api` 内运行：脚本只将无凭证的 `scripts/integration.py` 拷贝到容器 `/tmp/ordivant-validation/`，由容器内 Python 从 `/data/bootstrap.json` 读取 bootstrap，连接 `http://work-api:8000` 与 `http://runtime:8090`；不需发布 API 或 runtime host port。最后会恢复 peer APIs、重启三个 API，并确认 Work task 为 `done`、Knowledge 文档至少到 v3、Code PR binding 与 seed 数据仍可读。此模式要求 Gitea 与 Pi runtime services 已在该 project 运行。

<span id="報告與恢復"></span>
<span id="报告与恢复"></span>

## 报告与恢复 {#reports-and-recovery}

每次运行在 `.data/validation/containers-<project>-<timestamp>-<id>/report.json` 留下不含 credential 的检查结果。Development peer API 的恢复安排在 `finally`；若 `peer_restore` 不是 `passed`，请只对该 project 运行 `scripts/containers.ps1 -Action status -Development -WithGitea -WithRuntime -ProjectName <project>`，确认状态后用 helper 的 `up` 动作恢复停止的服务。不要对其他 Compose project 运行操作，也不要使用 `down -v`。
