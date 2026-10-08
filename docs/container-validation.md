# Compose 容器驗收

`scripts/container_acceptance.py` 驗收由 `scripts/containers.ps1` 已啟動的 Compose project。它不會執行 `up` 或 `down`，也不會刪除 volumes。Development 驗收會短暫停止同一 project 的 Knowledge 與 Code API，以確認 Work 對既有 VCS 的連線不依賴兩個 peer，之後會在 `finally` 區段將它們啟動；結尾會重啟三個 API 並檢查資料仍可讀。

## 啟動 Development

PowerShell：

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
./scripts/containers.ps1 -Action up -Development -Seed -WithGitea -WithRuntime -ProjectName ordivant-dev
```

請先確認 helper 顯示 project ready，再執行：

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
uv run --project backend python scripts/container_acceptance.py --project-name ordivant-dev --development
```

Development 預設驗收 Web `5173`、Work `8000`、Knowledge `8010`、Code `8020`、Pi runtime `8090`，並由 Compose 查詢 Gitea loopback host port。可用 `--web-port`、`--work-port`、`--knowledge-port`、`--code-port`、`--runtime-port`、`--gitea-port` 或 helper 同名環境變數覆寫。

腳本會從 `.data/container-secrets/<project>/gitea.json` 讀取 Gitea 設定，確認 URL 指向 Compose 內網 `gitea:3000`；再透過 `docker compose exec -T <product>-api python -c ...` 擷取各產品 `/data/bootstrap.json`。憑證只留在驗收程序記憶體並傳給現有 `scripts/suite_integration.py` flow；不會輸出 bootstrap、Gitea token 或 webhook secret。

Development 檢查包含：三個 API 使用 PostgreSQL 與 development mode；已接入 Identity，因此三個 local-session 經 Vite proxy 或直連 API 都回傳 403；Knowledge immutable version/CAS、Work delegation/review、Code 真實 Gitea repo/branch/commits/PR/status/webhook、三產品 MCP SDK，以及已啟動 runtime 的 Pi dispatch acceptance。接著腳本把 project-scoped `/data/vcs.json` 透過 `docker compose exec -T ... python -c ...` 的標準輸入寫入 Work data volume，停止 Knowledge/Code API，並在 peers 停止時驗證 Work REST、MCP 和獨立任務審查流程。完整的人員登入生命週期由 [登入驗收](auth-validation.md) 的隔離環境檢查。

完成後三個 API 會重啟。腳本會再次確認 Work 已接受任務、Knowledge 已發布版本和 Code PR binding 均留存。若 `-WithRuntime` 未啟動，報告會明確標記 runtime 為 skipped；需要完整 runtime gate 時請以該選項啟動。

## 驗收 Production

```powershell
$env:UV_CACHE_DIR = (Join-Path (Get-Location) '.cache/uv')
./scripts/containers.ps1 -Action up -Seed -WithGitea -ProjectName ordivant-prod
uv run --project backend python scripts/container_acceptance.py --project-name ordivant-prod
```

Production 驗收經由 Web `8088`（或 `ORDIVANT_WEB_PORT`）檢查 `/api`、`/knowledge-api`、`/code-api` 健康狀態與 PostgreSQL；三個 local-session 必須全部回應 403。腳本會重啟三個 API，等待 proxy health 恢復，再以各產品 bootstrap token 確認 Work seeded project、Knowledge primary space、Code project 仍可讀。Production Compose 預設不公開 API 或 Pi runtime port，所以此模式不宣稱完成 Development 的跨產品全流程、peer-stop 或 runtime acceptance。

Production 完整驗收需以 `-WithRuntime` 啟動既有 project，再加上 `--full-flow`：

```powershell
./scripts/containers.ps1 -Action up -Seed -WithGitea -WithRuntime -ProjectName ordivant-prod
uv run --project backend python scripts/container_acceptance.py --project-name ordivant-prod --full-flow
```

`--full-flow` 只驗收已啟動的 production project，不會執行 Compose `up` 或 `down`。它保留 production health、local-session 403 與 scoped seed reads，接著透過 Web proxy 執行既有 `suite_integration.py` REST/MCP/真實 Gitea 流程，再停止 Knowledge/Code API 驗證 Work REST、MCP 與既有 VCS 工作流程。Pi Durable acceptance 在同 project 的 `work-api` 內執行：腳本只將無憑證的 `scripts/integration.py` 複製到容器 `/tmp/ordivant-validation/`，由容器內 Python 從 `/data/bootstrap.json` 讀取 bootstrap，連線 `http://work-api:8000` 與 `http://runtime:8090`；不需發佈 API 或 runtime host port。最後會恢復 peer APIs、重啟三個 API，並確認 Work task 為 `done`、Knowledge 文件至少到 v3、Code PR binding 與 seed 資料仍可讀。此模式要求 Gitea 與 Pi runtime services 已在該 project 執行。

## 報告與恢復

每次執行在 `.data/validation/containers-<project>-<timestamp>-<id>/report.json` 留下不含 credential 的檢查結果。Development peer API 的恢復安排在 `finally`；若 `peer_restore` 不是 `passed`，請只對該 project 執行 `scripts/containers.ps1 -Action status -Development -WithGitea -WithRuntime -ProjectName <project>`，確認狀態後用 helper 的 `up` 動作恢復停止的服務。不要對其他 Compose project 執行操作，也不要使用 `down -v`。
