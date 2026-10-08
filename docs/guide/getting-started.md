# 開始使用 Ordivant

本指南以 Docker Compose 建立本機開發環境。Work、Knowledge、Code 和 Identity 會啟動在同一個瀏覽器入口；資料仍分別存放在各產品自己的資料庫與 volume。

## 準備環境

- Git。
- Docker Desktop（Windows/macOS，使用 Linux containers）或 Linux Docker Engine。
- Docker Compose v2 plugin，可執行 `docker compose`。
- PowerShell 7（`pwsh`）。`scripts/containers.ps1` 在 Windows 和 Linux 使用同一套參數。

不需要先在主機安裝 Python、Node.js 或 `uv`。第一次啟動會建置映像並下載所需容器映像，所需時間取決於網路和主機效能。

## 複製並啟動

在 Windows PowerShell 7 中執行：

```powershell
git clone https://github.com/bigtongue5566/ordivant.git
Set-Location ordivant
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Seed
```

在 Linux shell 也可以這樣呼叫：

```bash
git clone https://github.com/bigtongue5566/ordivant.git
cd ordivant
pwsh -NoProfile -File ./scripts/containers.ps1 -Development -ProjectName ordivant-dev -Seed
```

預設會選取三個產品。開啟 `http://127.0.0.1:5173`，在首次設定頁建立你自己的管理員帳號。沒有內建人類帳號或預設密碼。首次建立的管理員會取得一次性復原碼，請自行安全保存；密碼與復原碼不要貼到聊天、命令列或日誌。更多登入與邀請說明見[人類登入](../human-login.md)。

`-Seed` 是明確的示範資料初始化選項：它在所選產品建立標示為 DEMO 的業務範例，並建立產品 API／Agent 所需的本機 bootstrap 憑證。它不建立 Identity 的人類帳號、不設定企業 SSO，也不代表已連接付費模型。不要把 `.data` 或容器 secrets 加入 Git。

這個最小啟動可瀏覽三個產品與 Work 的一般任務流程，但不會啟動 Pi Runtime、Gitea 或沙箱。要在新環境一次啟動 Agent Runtime、Code 寫入與 Docker 沙箱，改用完整命令：

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Seed -WithGitea -WithRuntime -WithSandbox
```

Linux 使用 `./scripts/containers.ps1` 路徑。若已先啟動最小環境，使用相同 `-Development` 和 `-ProjectName` 加上 `-WithGitea -WithRuntime -WithSandbox` 即可；不要再次加 `-Seed`。新環境若只要 Runtime、不需要 Code 寫入或沙箱，可只加 `-WithRuntime`。`-WithSandbox` 必須同時啟動 Work 和 Runtime。

## Seed 與 Runtime

Seed 和 Runtime 是兩個不同步驟。Seed 在 Work 的持久資料目錄建立 `bootstrap.json`，Runtime 啟動時使用它取得服務所需的初始連線資料。新環境若直接加 `-WithRuntime` 卻沒有既有 Work bootstrap，helper 會停止並提示使用 `-Seed`；它不會在背景偷偷產生示範資料。對已初始化的資料，之後可在同一 Compose project 加入 Runtime。

Runtime 未取得可用的模型連線時，執行會使用明確標示的 DEMO fallback；這不是付費模型執行。模型連線由管理員在 Work 設定並按 Agent 套用，請參閱[執行與自動化指南](../execution-usage.md)。

## 檢查與停止

以相同的專案名稱查看服務狀態、查看服務日誌或停止容器：

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action status
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action logs -WithRuntime -WithGitea -WithSandbox
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action down
```

Linux 將腳本路徑改為 `./scripts/containers.ps1`。`down` 只停止該 Compose project 並保留 named volumes；不會清除資料。要重新啟動，使用先前相同的 project name 和功能選項。

PowerShell 7 在 Linux 可參考[容器操作說明](../containers.md)。生產目標不加 `-Development`，預設 Web port 是 `8088`；對外提供服務前，需設定可信 HTTPS origin、secure cookie、身分服務及資料備份，不能把本機開發設定直接當成正式部署。

## 接下來

- [Work：任務與審核](work.md)
- [Knowledge：文件、版本與引用](knowledge.md)
- [Code：Repository 與 Pull Request](code.md)
- [管理員、角色與 SSO](administration.md)
- [維運與備份](operations.md)
- [排除常見問題](troubleshooting.md)
