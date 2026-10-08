# Knowledge 獨立容器驗收

`scripts/standalone_container_acceptance.py` 對由 `scripts/containers.ps1` 啟動的 Knowledge-only Production Compose project 執行黑箱驗收。它不執行 `up`、`down`、停止其他服務或刪除 volumes；唯一的 lifecycle 操作是重啟指定 project 的 `knowledge-api`，然後透過 Web proxy 等待 API 健康。

## 啟動與驗收

PowerShell 從 repository root 執行：

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
$env:ORDIVANT_WEB_PORT = '8089'
./scripts/containers.ps1 -Action up -Products knowledge -Seed -ProjectName ordivant-knowledge-qa
```

確認 helper 顯示 ready 後執行：

```powershell
uv run --project backend python scripts/standalone_container_acceptance.py --project-name ordivant-knowledge-qa --web-port 8089
```

腳本只透過 `docker compose` 的明確 project name 操作該 project，並要求其容器清單剛好為 `knowledge-api`、`knowledge-db`、`web`、`identity-api`、`identity-db`。登入服務須健康，且首次設定尚未由測試初始化。Web origin 固定為 loopback `127.0.0.1`；`--web-port` 只接受有效 TCP port，不接受外部 host。

驗收會確認 `/api/health` 回報 PostgreSQL 與 production mode、production `local-session` 回應 403、scoped writer/reader 可讀 primary space 且 writer 無法讀 isolated space。它建立一份唯一標記的文件，檢查重複 Idempotency-Key 不會重複建檔、reader 可讀 exact version、全文搜尋回傳 exact-version citation，以及 reader 寫入遭拒。

官方 MCP Python SDK 會在 `knowledge-api` 容器內透過 stdio 啟動 Knowledge MCP server，以 bootstrap writer bearer 呼叫 `get_document_version` 並檢查八個工具存在。最後僅重啟 `knowledge-api`，確認健康回復且 exact document body/hash 持續存在。

Bootstrap 只用 `docker compose exec -T knowledge-api python -c ...` 從容器 `/data/bootstrap.json` capture 至驗收程序記憶體；MCP 的 writer token 由標準輸入送給容器內 Python，兩者都不會放入 shell 命令參數。報告存於 `.data/validation/standalone-knowledge-<project>-<timestamp>-<id>/report.json`，只保留非敏感驗收結果。
