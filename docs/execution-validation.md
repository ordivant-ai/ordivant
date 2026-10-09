<span id="執行功能驗收"></span>
<span id="运行功能验收"></span>

# 執行功能驗收 {#execution-feature-acceptance}

日期：2026-10-08（Asia/Taipei）。Run 執行控制台、Agent 範本／自動流程與 MCP 工具／沙箱已完成本機交付；包含真實授權模型回合、容器、重啟、併發與滑鼠操作驗收。

範圍與權限：[執行契約](execution-contracts.md)。操作：[使用說明](execution-usage.md)。驗收使用獨立的 `ordivant-execution-qa` PostgreSQL 環境與 `127.0.0.1:8092`，登入使用先前獲授權的合成 QA 帳號。

<span id="已取得的證據"></span>
<span id="已取得的证据"></span>

## 已取得的證據 {#evidence-collected}

| 驗證 | 結果 | 涵蓋 |
|---|---|---|
| Work 後端 | 41 項測試通過；compileall 通過 | Run 權限、lease、停止／重跑、terminal sync 回應遺失重放、實際提交／快速 review 完成檢查、有效租約重交付、不可變版本、排程鎖順序、工具認證遮蔽與 scope |
| 既有產品回歸 | Identity 28、Knowledge 10、Code 20 項測試通過 | 既有企業登入、各產品授權與 service 行為 |
| Runtime／Pi SDK | 25 項測試通過；建置通過 | 真實 Pi 工具事件與收據、續租／進度交錯、平台寫入新 token、pause、reply-loss 同 body／sequence 重試、完成證據比對與有效租約恢復；延遲／失敗的 workspace 清理及 terminal Run 重啟恢復 |
| 沙箱服務 | 3 項測試通過 | 參數／路徑限制、服務授權與 command 錯誤；實際 Docker 驗證另列 |
| REST／MCP／Pi 回歸 | 通過；官方 SDK 發現 29 個工具 | 真實 collaboration／claim 競爭／scope／依賴／review／冪等；實際 Pi DEMO outbox 回合 |
| 完整執行容器 | 53 項檢查通過 | queued stop／retry、新 execution 與歷史、真實工具事件、兩步驟 DAG 自動派工／獨立 review、實際分鐘間隔、不重疊／取消、全新專案 runtime 授權、沙箱與 Work／runtime 重啟 |
| 真實授權模型回合 | 20 項檢查通過 | `測試 Provider／gpt-6.1-sol` 真實 MCP wait／add、工具邊界 pause→resume 並保留同 execution、實際 Python exit 0／刻意 exit 7、獨立 PM review、receipt／execution 重啟持久化 |
| 真實紀錄與清理 | 16 項檢查通過 | 離線檢查 Pi MCP result 的 sum=42；provider／MCP 加密、派工憑證撤銷、Pi／RunStore／idempotency／最近 logs 無已知憑證、沒有 QA job 殘留 |
| 最終 terminal 清理回歸 | 9 項檢查通過 | 不呼叫付費模型的實際 Docker job：建立 workspace、完成 DEMO 工具回合，等待真正的清理後才同步 sandbox stopped／不可用，再由獨立 PM review；沒有 job 殘留 |
| PostgreSQL 實際併發 | 8 項檢查通過 | 六次版本發布得到 v2–v7；六次手動啟動一個成功；八次 tick 只建立一個排程流程 |
| 真實 MCP／API 設定 | 26 項檢查通過 | 官方 MCP tools/list、Bearer 認證、白名單主機、write-only 金鑰、Agent 建立／編輯、範本版本、流程依賴／冪等 |
| 真實 Docker executor | 67 項檢查通過 | Python／Node／Git、檔案與命令、exit 0／7、非 root、唯讀根目錄、network none、resource／workspace／output 限制、path／symlink／FIFO、逾時及清理 |
| Executor 異常重啟 | 2 項檢查通過 | 對 QA 執行器 SIGKILL 後重新啟動，兩個實際孤兒 job 被清理 |
| 瀏覽器實際操作 | 表單／自動化 45 項檢查、Run 控制台 10 項檢查、Live inspector 10 項檢查通過 | 桌面 1440×1000 與 390×844；滑鼠下拉／虛擬清單捲動、範本及工具／沙箱綁定、Agent 修改、流程啟動；真實伺服器已提交後遺失回應，重試得到同一個 instance／Run；停止／重跑、真實模型用量／MCP 工具／沙箱 stdout／exit0／7與手機詳細頁 |
| 前端 | TypeScript、Suite／Work／Knowledge／Code 建置通過 | 四種可獨立建置的產品模式；既有 bundle 大小警告仍存在 |
| 兩套本機環境保留／健康 | 40 項檢查通過 | 5173／8088 的帳號數、初始設定 marker、SSO／模型／加密 provider 設定摘要及專案數與更新前一致；產品入口／API 200，Identity／各產品／web／runtime／sandbox healthy |
| 隔離 QA 收尾 | 8 項檢查通過 | 自有容器、網路及 job 均已移除，named volumes 保留，兩套主環境 Work／Identity 仍為 200 |

DEMO 與合成服務的檢查會分別標示；只有真實模型那一列代表實際呼叫 provider。最後一筆即時執行收據回報要求與回傳模型均為 `gpt-6.1-sol`，輸入 40,000 tokens（其中快取 16,128）、輸出 744、合計 40,744；工具呼叫包括 MCP wait／add 各一次、平台 progress 一次、sandbox write 一次，以及 execute 兩次。供應商實際路由與帳單尚未核對，`cost_usd=null`，因此 UI 顯示成本未知。

<span id="可重現的證據位置"></span>
<span id="可重现的证据位置"></span>

## 可重現的證據位置 {#reproducible-evidence}

驗收程式位於 `scripts/execution_acceptance.py`、`execution_postgres_probe.py`、`sandbox_probe.py`、`execution_browser.py`／`execution_ui.cjs`、`execution_run_browser.py`／`execution_run_ui.cjs`、`execution_live_acceptance.py`／`execution_live_ui.cjs`、`execution_record_checks.py`、`execution_cleanup_acceptance.py` 與 `execution_local_readiness.py`。完整啟動與測試命令見使用說明。

報告保存在本機 `.data/validation/`：`execution-e8f561d8/report.json`（53）、`execution-55faa750/live-report.json`（20）／`record-checks.json`（16）、`execution-cleanup.json`（9）、`execution-postgres.json`、`sandbox-integration.json`、`sandbox-crash-recovery.json`、`execution-browser/report.json`、`execution-run-browser/report.json`、`execution-live-browser/report.json` 與瀏覽器 PNG。主環境保留／健康在 `execution-local-before.json`／`execution-local-after.json`（40）。REST／MCP／Pi 回歸在 `20261008-021346-6e1664/report.json`。報告只保存結果與合成資源 ID，不保存帳號密碼、provider／MCP 金鑰、Agent credential 或沙箱 capability。早期失敗報告保留供追查；以本段指定的最後成功報告為準。

終端狀態同步會等待執行器的清理 Promise 完成，再讀取最新 RunStore。清理 DELETE 失敗時，sandbox 會顯示為 `failed`，並記錄固定的「清理尚未確認」事件；若舊的 terminal workspace 在重新啟動後失去 capability，狀態會顯示為 `lost`，不會重新執行模型，也不會宣稱工作區已刪除。延遲與失敗情境的檢查也確認，等待清理期間 task／delivery heartbeat 仍持續續租。

歷史 Live 驗收曾在操作者授權下沿用其測試連線。公開版本已移除從開發環境資料庫讀取／解密憑證的專用 helper 行為；重現驗收需明確設定隔離 `*-qa` Compose project、HTTPS endpoint、model 及自己的 key 檔案，見[操作說明](execution-usage.md)。公開原始碼不包含當次連線設定、金鑰或原始 QA 資料。

兩套既有主環境更新時沒有執行 Seed；使用者仍自行建立第一位管理員。開發模式保留既有加密模型連線，本機 production 模式保留未設定 provider 的狀態。各自的四個 PostgreSQL、Gitea、應用程式、runtime 與沙箱服務均 healthy。隔離 `ordivant-execution-qa` 容器／網路已以 helper down 清除，資料卷及驗收報告保留；收尾證據在 `execution-teardown.json`（8）。沒有對外部署、推送或發布。
