# Code 獨立容器驗收

此驗收確認 Ordivant Code 可用 production Compose 設定獨立啟動，Work、Knowledge 與 Pi runtime 均不屬於此 QA project。驗收器只檢查已啟動的 Compose project；不會建立、停止或刪除容器與資料 volume。

## 啟動與執行

在 repository 根目錄以 PowerShell 執行：

```powershell
$env:ORDIVANT_WEB_PORT = '8091'
.\scripts\containers.ps1 -Products code -Seed -ProjectName ordivant-code-qa
$env:UV_CACHE_DIR = '.cache/uv'
uv run --project products/code/backend --no-sync python scripts/code_standalone_acceptance.py --project-name ordivant-code-qa
```

不加 `-WithGitea`，讓服務以明確未設定 Gitea 的狀態啟動。驗收結束後保留 QA containers 供查核；若需管理它們，`scripts/containers.ps1` 必須使用同一個 `-ProjectName`。

## 驗收內容

驗收器要求該 Compose project 恰有五個 running services：`code-api`、`code-db`、`web`、`identity-api` 與 `identity-db`。登入服務須健康，且首次設定尚未由測試初始化。它會檢查 web root 載入的是只含 Code workspace 的 production bundle，並透過 `/api/health` 確認產品為 Code、資料庫為 PostgreSQL、mode 為 production，且 `gitea_configured` 為 `false`。

它會從 Code API container 讀取 seed bootstrap 至程序記憶體，檢查 production local-session 回應 `403`、manager 可見兩個 seed projects、writer 與 reader 只看得到 primary project、writer 無法讀取 isolated project，以及 reader 建立 project 回應 `403`。manager 會建立一個具唯一 key 的驗收 project；只有這項真實 project 寫入必須成功並在只重啟 `code-api` 後仍可讀取。

驗收也會嘗試建立 repository，並要求未設定 Gitea 時回應 `503` 與 `gitea_not_configured`。此結果代表 Git repository、branch、commit、pull request 和 status 操作仍不可用；不得將 metadata project 建立解讀為 Git 寫入成功。最後會在 Code API container 內啟動 official MCP SDK stdio client，精確比對九個 tools，並透過 `list_repositories` 與 `get_code_events` 對 Code REST service 執行唯讀 round trip。

JSON report 寫在被忽略的 `.data/validation/standalone-code-.../report.json`，並輸出各項 check 與第一個失敗 predicate。bootstrap token 不會加入 report 或診斷輸出。最終 readiness 無論前段檢查是否成功都會執行。
