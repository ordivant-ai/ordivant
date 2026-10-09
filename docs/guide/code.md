# Ordivant Code

Code 將有範圍的 Code Project 綁定到實際 Gitea repository，提供建立 repository、branch、檔案 commit、Pull Request 及狀態收據的介面。Git 與 PR 的實際狀態由 Gitea 保存；Code 服務保留授權範圍、引用和操作收據。

<span id="啟用-gitea"></span>
<span id="激活-gitea"></span>

## 啟用 Gitea {#enable-gitea}

Gitea 是可選服務。沒有 Gitea 時 Code API 仍可啟動並檢視已保存的中繼資料，但需要上游寫入的 repository、branch、commit、PR 和 status 操作會不可用。

新開發環境可一次啟用：

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Seed -WithGitea
```

若已先啟動相同 ProjectName 的三產品環境，可只加 `-WithGitea` 重跑 helper，不要重新 seed。Linux PowerShell 7 使用 `./scripts/containers.ps1`。Gitea service credential 由 helper 建立並留在 ignored local secret directory；不要列印、提交或手動複製到 Agent 設定。

<span id="repository-到-pr"></span>

## Repository 到 PR {#from-repository-to-pull-request}

1. 選擇已授權的 Code Project。具管理權者可以建立新 Project；若尚無存取權，請 Identity 管理員授權。
2. 由具 write 權限的人建立 Private repository。Code 將 repository 綁定到所選 Project。
3. 選取 repository 後建立 branch，選擇來源 branch；再選 branch，提交 UTF-8 檔案內容與 commit message。修改既有檔案時會依現有版本保護更新。
4. 建立 PR，填入 head branch、base branch、標題與描述。使用「Work / Knowledge / 外部來源」加入來源引用，例如核對過的 Knowledge 精確版本 URI。
5. 在 PR 詳情檢視 head SHA、state、來源引用與狀態收據。PR 的評審／合併仍依組織的 Gitea 流程處理；Ordivant 不會自動批准 Work 任務。

Code 權限以 Code Project 為範圍：**Manager** 建立及管理 Project，**Writer** 在已授權 Project 操作 repository，**Reader** 查閱資料。Gitea service credential 不會回傳到瀏覽器，Code 仍會在每個操作檢查平台端 Project scope。

<span id="pr-狀態與證據"></span>
<span id="pr-状态与证据"></span>

## PR 狀態與證據 {#pr-status-and-evidence}

「回報狀態」可把指定 commit 的 pending、success、failure 或 error 回報到 Gitea。這類收據明確標記為 `agent_reported`，不代表實際 CI runner 執行過測試。有效的 Gitea webhook 收據會標記為 `gitea_webhook`。此套件目前不包含 CI runner；請在描述中說清楚狀態來源與測試實際執行情況。

PR 來源引用是 provenance，不會使 Code 使用者自動取得 Work、Knowledge 或外部系統權限。Work 可獨立連接既有 VCS 讀取 PR 狀態，不必先啟用 Code；兩者的邊界見[產品契約](../suite-contracts.md)。
