<span id="knowledge-獨立容器驗收"></span>
<span id="knowledge-独立容器验收"></span>

# Knowledge 独立容器验收 {#knowledge-standalone-container-acceptance}

`scripts/standalone_container_acceptance.py` 对由 `scripts/containers.ps1` 启动的 Knowledge-only Production Compose project 运行黑箱验收。它不运行 `up`、`down`、停止其他服务或删除 volumes；唯一的 lifecycle 操作是重启指定 project 的 `knowledge-api`，然后透过 Web proxy 等待 API 健康。

<span id="啟動與驗收"></span>
<span id="启动与验收"></span>

## 启动与验收 {#start-and-acceptance}

PowerShell 从 repository root 运行：

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
$env:ORDIVANT_WEB_PORT = '8089'
./scripts/containers.ps1 -Action up -Products knowledge -Seed -ProjectName ordivant-knowledge-qa
```

确认 helper 显示 ready 后运行：

```powershell
uv run --project backend python scripts/standalone_container_acceptance.py --project-name ordivant-knowledge-qa --web-port 8089
```

脚本只透过 `docker compose` 的明确 project name 操作该 project，并要求其容器清单刚好为 `knowledge-api`、`knowledge-db`、`web`、`identity-api`、`identity-db`。登录服务须健康，且首次设置尚未由测试初始化。Web origin 固定为 loopback `127.0.0.1`；`--web-port` 只接受有效 TCP port，不接受外部 host。

验收会确认 `/api/health` 回报 PostgreSQL 与 production mode、production `local-session` 回应 403、scoped writer/reader 可读 primary space 且 writer 无法读 isolated space。它创建一份唯一标记的文档，检查重复 Idempotency-Key 不会重复建档、reader 可读 exact version、全文搜索回传 exact-version citation，以及 reader 写入遭拒。

官方 MCP Python SDK 会在 `knowledge-api` 容器内透过 stdio 启动 Knowledge MCP server，以 bootstrap writer bearer 调用 `get_document_version` 并检查八个工具存在。最后仅重启 `knowledge-api`，确认健康回复且 exact document body/hash 持续存在。

Bootstrap 只用 `docker compose exec -T knowledge-api python -c ...` 从容器 `/data/bootstrap.json` capture 至验收进程内存；MCP 的 writer token 由标准输入送给容器内 Python，两者都不会放入 shell 命令参数。报告存于 `.data/validation/standalone-knowledge-<project>-<timestamp>-<id>/report.json`，只保留非敏感验收结果。
