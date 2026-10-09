<span id="執行、範本、自動流程與工具環境"></span>
<span id="运行、模板、自动流程与工具环境"></span>

# 執行、範本、自動流程與工具環境 {#runs-templates-workflows-and-tool-environments}

Run、Agent 範本、工作流程與工具連線由 **Work** 管理；Knowledge／Code 仍可獨立使用，不需要啟動沙箱。API 與權限規則見[架構與 API 索引](reference.md#work-api)。

第一次使用時，先登入 Work，由管理員在「模型連線」設定 API endpoint、金鑰與預設模型；再建立需要的工具連線／沙箱與 Agent，最後手動派工或啟動工作流程。已存在的組織模型設定可直接沿用。沒有設定有效模型時，執行明確標示為 DEMO。

<span id="啟動"></span>
<span id="启动"></span>

## 啟動 {#start}

開發環境與一般部署環境可使用以下 Compose 指令：

```powershell
# 開發模式：熱重載，啟動隔離執行器。
.\scripts\containers.ps1 -Development -WithRuntime -WithSandbox

# 部署用 images：本機 Nginx 與 PostgreSQL。
.\scripts\containers.ps1 -WithRuntime -WithSandbox
```

新建的示範環境加 `-Seed`；它會建立標示為 DEMO 的業務資料，管理員帳號仍由使用者在網頁自行建立。若需要 Code 的本機版控，加 `-WithGitea`。兩種模式各有自己的資料與帳號。沙箱 API 不發布主機連接埠，只接受內部 runtime 呼叫。

<span id="run-執行控制台"></span>
<span id="run-运行控制台"></span>

## Run 執行控制台 {#run-console}

1. 選擇專案，在任務中派發 Pi Agent。派工後會立刻出現 queued Run。
2. 開啟「Run 執行」，檢視任務、Agent、execution、狀態及模型快照；選取 Run 可查看事件、工具結果及實際 token receipt。
3. 管理員／專案 manager 可以要求暫停、繼續、停止或重跑。其他成員可以檢視自己獲授權的專案。

「暫停」會在下一個工具操作前等待；正在進行的模型或工具呼叫可以先結束。畫面將要求暫停與確實進入 paused 分開顯示。Pi 目前沒有立即凍結模型請求的 pause API。等待期間仍續租，並計入整次 Run 的時間上限。「恢復」解除同一次執行的等待。重啟時，服務僅重新交付仍有效的原 execution 租約；已過期或遺失 ownership 會失敗並要求重新派工。無法確認是否完成的外部副作用不會自動重播。

「停止」立即撤銷業務執行的寫入資格，再終止模型／沙箱；任務回到 ready。已啟動的外部工具若產生副作用，需要依其服務結果核對。終止 Run 不會自動刪除證據。失敗／停止的 Run 可重跑，會建立新的 Run 和 execution 並保留來源連結。已驗收完成的任務不會被重跑按鈕重新開啟。

Run 的 done 代表模型執行與提交完成；任務仍要由獨立審查者接受才是 done。DEMO 不呼叫付費模型；Live receipt 顯示實際回傳的模型與用量。未取得的 token 或美元費用顯示未知。

<span id="agent-範本"></span>
<span id="agent-模板"></span>

## Agent 範本 {#agent-templates}

在「自動化 → Agent 範本」建立角色、能力、指令、模型、工具白名單、沙箱與執行限制。每次修改都發布新的不可變版本。新增或編輯 Agent 時選擇確切版本，也能調整個別設定；設定儲存後的下一次派工才生效。

舊版範本及已派工 Run 的快照保持可追溯。範本不授予新的專案權限；Agent 必須原本就被授予工具與沙箱所在專案。模型連線仍由組織管理員維護，範本不存放 API key。

<span id="自動工作流程"></span>
<span id="自动工作流程"></span>

## 自動工作流程 {#automated-workflows}

在「自動化 → 工作流程」建立步驟與前置依賴。每一步指定 Pi Agent，或指定必須具備的能力；可指定獨立 reviewer。步驟可以平行，但依賴必須形成無環的圖。

手動啟動時提供整次流程的文字輸入。系統建立每一步的任務，runtime 排程器會自動派發符合條件的工作。沒有可用 Agent 時保留等待狀態；已有前置任務待審時，也會等待。Reviewer 接受前置成果後，後續步驟會自動開始。所有步驟都通過獨立驗收，流程才會完成。

定時啟動使用分鐘間隔與最多啟動次數；runtime 必須持續運行。同一排程的進行中流程會阻止重疊啟動，不補發停機期間所有漏掉的週期。取消流程會停止尚未完成的任務與 Run；已驗收成果保留。新版工作流程不會更改已經啟動的版本。

<span id="外部-mcp-工具"></span>

## 外部 MCP 工具 {#external-mcp-tools}

部署操作者先允許受信任的 MCP 服務主機，再由 Work 管理員在「工具與沙箱」新增專案連線。第一版使用 MCP Streamable HTTP；不接受任意主機 stdio 命令。

```powershell
$env:ORDIVANT_TOOL_ALLOWED_HOSTS = 'mcp.company.example'
.\scripts\containers.ps1 -Development -WithRuntime -WithSandbox
```

填入 HTTPS MCP endpoint、write-only bearer token 與允許的 tool names，按「測試連線」取得真實 tools/list。HTTP 只用於明確指定的私有／本機測試服務，還需 `ORDIVANT_TOOL_HTTP_HOSTS`；解析至內網、loopback 或其他非公開位址時，各模式均需 `ORDIVANT_TOOL_PRIVATE_HOSTS`。HTTPS 私網服務也要正常的 TLS 憑證。預設沒有允許的外部主機。URL 中不能含帳密，也不能透過 redirect 將認證送往其他服務。

連線金鑰加密保存，不回填到表單；留白保留原金鑰。變更有認證的 endpoint 時需明確重新輸入金鑰。Agent 綁定後只會取得該執行專案允許的工具，工具名稱會加入命名空間。外部操作預設不自動重播；不確定的副作用不會被當成成功或自動重做。

目前提供 bearer 認證；尚未支援各廠商的互動式 MCP OAuth、stdio launcher 和遠端 A2A。

<span id="沙箱"></span>

## 沙箱 {#sandboxes}

管理員新增專案沙箱設定，限制 command 時間、記憶體、CPU、process 數、輸出 bytes 與 workspace 空間。將設定套用至 Agent。派工時固定設定快照，runtime 會提供讀寫檔案、列出檔案、執行 argv command 的沙箱工具。

每個 Run 使用獨立容器與有大小上限的記憶體 workspace；程序以非 root 身分執行，系統檔案唯讀，且無網路、主機目錄或 provider／工具／平台憑證。內含 Python、Node.js 與 Git，可執行映像中已有依賴的程式與測試。網路關閉，因此需要的套件應由部署者預先加入固定 job image，或由授權檔案工具寫入；目前不支援任意 Git 網址 clone 或線上安裝套件。

失敗 command 會保留非零 exit code，超時及截斷的輸出會明確標記。檔案只能使用相對 workspace 路徑，拒絕 traversal 與 symlink escape。成果檔案／測試輸出需在 Run 結束前提交為證據；Run 結束、停止或整次執行超時會清理 workspace，執行器重啟會清理自己擁有的孤兒工作。單一 command 超時會終止其 process group 並保留明確結果。這不是長期檔案儲存。

清理 API 未成功確認時，控制台會顯示 sandbox failed 與清理未確認錯誤；重啟後原臨時工作區失聯時顯示 lost。模型成果與清理狀態分開記錄。操作者需檢查／重啟自己擁有的執行器完成孤兒清理；系統不把未確認刪除標成成功，也不自動重跑模型副作用。

只有獨立受信任的 `sandbox-api` 服務持有 Docker daemon socket；Work、runtime、瀏覽器與 job 均不持有。該服務的內網與服務憑證由部署操作者控制。Docker 隔離使用共用 kernel；要求 VM 邊界的企業應另接 VM／microVM 執行器。

<span id="隔離驗收"></span>

## 在專案中驗證執行結果 {#isolated-acceptance}

可在自己的專案執行一個低風險任務，確認 Run 從 queued 進入執行與提交狀態，再由具備權限的另一位成員獨立審核成果。DEMO 只驗證產品流程，不代表已呼叫付費模型；若使用已設定的模型連線，請先確認供應商、模型與費用政策。

使用工具連線時，先透過「測試連線」確認可取得允許的工具清單，再派發只會讀取或建立可安全清理測試資料的任務。到上游服務核對實際副作用；停止 Run 不會撤銷已由外部服務完成的操作，也不會自動重播結果不明的操作。

若 Agent 使用沙箱，確認檔案與命令結果在 Run 結束前已提交為證據，且 Run 結束後工作區會清理。沙箱 API 無法確認刪除時，控制台會標示清理未確認；部署者應檢查自己管理的執行器。Docker 隔離共用主機 kernel，需 VM 邊界時應連接 VM 或 microVM 執行器。
