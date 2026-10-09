<span id="排除常見問題"></span>
<span id="排除常见问题"></span>

# 排除常見問題 {#troubleshooting}

<span id="啟動與登入"></span>
<span id="启动与登录"></span>

## 啟動與登入 {#startup-and-sign-in}

| 現象 | 原因或檢查方式 | 處理方式 |
|---|---|---|
| helper 找不到 Docker Compose | Docker Desktop／Docker Engine 未啟動，或 Compose v2 未安裝 | 確認可執行 `docker compose version`，並使用 Docker Desktop 的 Linux containers。 |
| PowerShell 指令無法識別 | 呼叫到 Windows PowerShell 而非 PowerShell 7 | 安裝／啟動 `pwsh`，並從 repository root 執行 `scripts/containers.ps1`。Linux 路徑使用斜線。 |
| 服務啟動時 port 已被使用 | 另一個本機程序或 Compose project 佔用 port | 使用環境變數調整對應 port，例如 `ORDIVANT_DEV_WEB_PORT` 或 `ORDIVANT_GITEA_PORT`，再以相同 project name 重啟。 |
| 頁面顯示 API 無法連線 | API 尚未健康，映像仍在建置，或選到不同 Compose project | 等待 helper 完成；執行 `-Action status` 檢查服務，再用相同 project name 和已啟用 profiles 執行 `-Action logs`。 |
| 沒看到建立管理員的初始設定 | 此 Identity volume 已初始化，或目前指向另一個 Compose project | 核對 `-ProjectName` 和 `-Development` 模式。沒有預設帳號；請使用既有管理員或復原流程，不要刪除 volume 來試密碼。 |
| 登入成功但看不到 Project／Space | 人類 session 已建立，但該產品資源範圍尚未授予 | 請 Identity 管理員分配正確產品角色及明確資源 scope。SSO 網域不會自動授予資料存取權。 |

<span id="seed、runtime-與-run"></span>
<span id="seed、runtime-与-run"></span>

## Seed、Runtime 與 Run {#seed-runtime-and-runs}

| 現象 | 原因或檢查方式 | 處理方式 |
|---|---|---|
| Runtime 啟動提示找不到 Work bootstrap | 新 Work volume 尚未使用 `-Seed` 建立 bootstrap；Runtime 不會自行生資料 | 在全新 DEMO 環境明確加 `-Seed` 啟動一次，再以相同 project 加入 `-WithRuntime`。若已有正式資料，先確認備份與正確資料目錄，不要隨意 seed。 |
| 看不到示範任務 | Seed 是明確選項，或啟動時只選了部分產品 | 確認 `-Products` 選擇和正確 project。只有要建立 DEMO 時才明確使用 `-Seed`。 |
| Run 停留在 queued/waiting | Runtime 未啟動、Agent 不符合能力／scope、前置 Task 尚未被接受，或沒有可用 Agent | 確認 Work Runtime 健康；檢查 Agent 的角色、Project scope、能力和 workflow dependency/review 狀態。 |
| 執行結果標示 DEMO | 尚未為組織或 Agent 配置有效的模型連線 | 由管理員在 Work 設定供應商 endpoint/key 和 model，再設定 Agent 繼承或個別覆寫。DEMO 不代表已使用付費模型。 |
| Stop 後上游工具結果不明 | Stop 會撤銷 Run 寫入權；外部服務可能已執行副作用 | 先到該上游服務核對實際結果，再決定是否建立新 Run。系統不會自動重播不確定的外部操作。 |

<span id="knowledge、code-與-sso"></span>
<span id="knowledge、code-与-sso"></span>

## Knowledge、Code 與 SSO {#knowledge-code-and-sso}

| 現象 | 原因或檢查方式 | 處理方式 |
|---|---|---|
| Knowledge 搜尋找不到語意相近的內容 | 目前是標題／正文文字搜尋，非向量或 RAG 搜尋 | 使用正文確切詞彙、文件標題或 tag 篩選；確認有讀取該 Space 的權限。 |
| 發佈 Knowledge 版本回報衝突 | 預期版本已被其他 writer 更新 | 載入最新版本，檢查變更和引用，再基於最新版本重新編輯、發佈。既有版本不會被覆寫。 |
| Code 可讀但不能建立 repository／PR | Gitea profile 未啟動或 Code API 未連接 Gitea | 使用 `-WithGitea` 啟動相同 development Compose project，等待健康檢查後在 Code 重試。不要把 Gitea service credential 放入瀏覽器。 |
| PR 有 status 但無法確認測試曾執行 | `agent_reported` 是提交狀態收據，不是 CI runner 執行記錄 | 檢查收據來源；只有實際可驗證的 Gitea webhook 或外部測試系統才代表其對應事件，不要把回報寫成 CI 結果。 |
| OIDC callback 或登入循環失敗 | IdP Redirect URI 與管理介面顯示的 Callback URL 不完全一致，或 canonical HTTPS origin／cookie 設定不符 | 核對完整 callback URL、Issuer、允許網域及可信 public origin；先用一位成員驗證再改登入政策。設定步驟見[企業登入說明](../enterprise-sso.md)。 |

<span id="資料與服務目錄"></span>
<span id="数据与服务目录"></span>

## 資料與服務目錄 {#data-and-service-directories}

- 如果換了 clone 路徑後資料看起來消失，helper 的預設 Compose project 名稱可能不同。啟動時固定使用 `-ProjectName`，並用同一名稱管理 status/logs/down。
- `-Action down` 保留資料；再次執行 `docker compose down -v` 會移除 volumes，造成資料遺失。不要將 volume 清除當成一般排障步驟。
- 不要直接把 `.data/container-secrets`、bootstrap 檔、IdP client secret 或 Gitea 設定貼到日誌或 issue。helper 的 logs 輸出會遮罩已知服務 secrets；仍需先檢查輸出再公開分享。
- 備份需包含資料庫、data volumes 和對應 encryption keys。操作步驟見[維運與備份](operations.md)。
- Work/Knowledge/Code 各自有服務與資料邊界；一個產品健康不代表其他產品也可用。先查看產品自身 health/status，再檢查共用 Identity 或依賴服務。
