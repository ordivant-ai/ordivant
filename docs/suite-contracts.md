# Ordivant Suite 契約（修訂日期：2026-10-06） {#ordivant-suite-contract-—-revised-2026-10-06}

重新閱讀規劃對話後確認的使用者決策：Work、Knowledge 與 Code 是同一 monorepo 中各自獨立的產品。每個產品都能單獨部署、擁有自己的資料庫，並提供 API + MCP。Code 是選配，使用開源 Gitea 作為獨立 Git 服務。Work 必須能在 Code 未啟動時運作，並接受企業現有版本控制系統的參照。Pi Durable 屬於 Work。

## 程式碼責任與部署邊界 {#code-ownership-and-deploy-boundaries}

- `backend/`：Ordivant Work FastAPI／SQLAlchemy／MCP（保留既有程式碼）。
- `runtime/`：Work 的 Pi Durable Runtime（保留既有程式碼）。
- `products/knowledge/backend/`：獨立 uv 專案與 Python 套件 `ordivant_knowledge`，擁有自己的 SQLAlchemy engine／models／auth／seed 與 MCP。
- `products/code/backend/`：獨立 uv 專案與 Python 套件 `ordivant_code`，擁有自己的 SQLAlchemy engine／models／auth／seed 與 MCP；Gitea adapter 僅能透過 HTTP API／webhook 通訊。
- `frontend/`：共用 React 原始碼；產品模組與可分開建置的 Work／Knowledge／Code 成品。可共用視覺元件，不可共用私有業務狀態。
- `scripts/`、根目錄設定與 `docs/` 由 PM 負責。未經 PM 核准，Worker 不可修改指派模組以外的檔案。

不可匯入其他產品的 ORM、session、業務套件或資料庫。產品之間透過公開識別碼、HTTP API 與明確參照連結。Code 或 Knowledge 服務無法使用時，不得阻止 Work 啟動。

## 共用公開慣例 {#shared-public-conventions}

所有 API 都使用 `/api`、JSON 資源物件或陣列、ISO-8601 UTC 時間戳記，以及 `docs/contracts.md` 中定義的領域錯誤格式。每個產品都有自己的 bearer 憑證，並各自強制檢查 scope。`POST /api/auth/local-session` 只允許 loopback + 明確的 development 模式；`GET /api/me` 公開操作者中繼資料。Token 以雜湊形式儲存；API 清單、稽核、快取或 UI bundle 均不可包含 bearer 憑證。

Idempotency-Key 依實際路由 + 目前操作者 + 請求本文限定範圍。本文不同會產生衝突。重播快取回應時重新檢查目前授權。業務狀態與稽核／冪等記錄以原子方式 commit。PostgreSQL URL 透過 psycopg 支援；SQLite 為快速入門模式。SQLite 寫入序列化與 PostgreSQL row locking 用來保護版本／審查／並行轉換。

Development seed 須明確執行且可重複；在各產品自己的資料目錄建立 `bootstrap.json`。結構為 `{manager_token,writer_token,reader_token,manager_id,writer_id,reader_id,organization_id,primary_scope_id,isolated_scope_id}`；這些都是本機產生的憑證。Manager 擁有兩個 Seed scope；writer 與 reader 只能看到主要 scope。Principal 為 `{id,name,kind,role,organization_id,scope_ids:string[]}`。之後可使用共用企業 issuer／subject 將身分對應至多個產品；但每個產品仍各自執行授權。

不處理人類密碼，也不提示輸入憑證。Gitea 測試憑證僅由服務為自有本機測試 instance 產生；使用者提供的密碼必須遵守使用者的 tmux 規則。

## Knowledge API（連接埠 8010）{#knowledge-api-port-8010}

環境設定：`ORDIVANT_KNOWLEDGE_DATA_DIR` 預設為 repo `/.data/knowledge`；`ORDIVANT_KNOWLEDGE_DATABASE_URL` 為選填；`ORDIVANT_MODE` 嚴格限制為 development／production。進入點為 `python -m ordivant_knowledge.seed`、`uvicorn ordivant_knowledge.main:app` 與 `python -m ordivant_knowledge.mcp_server`。

`GET /api/health` -> `{status:"ok",product:"knowledge",database,mode}`。

`Space`: `{id,key,name,description,organization_id,created_at}`.
`Document`: `{id,space_id,title,summary,tags:string[],current_version:number,created_at,updated_at}`.
`Version`：`{id,document_id,version:number,title,body,change_summary,author_id,content_sha256,source_refs:Reference[],created_at,uri}`。已持久化的版本不可變。`DocumentContext`：`{document,version,history:Version[],decisions:Decision[]}`。
`Reference`：`{product:"work"|"knowledge"|"code"|"external",kind:"task"|"document_version"|"pull_request"|"test_report"|"url",uri,title}`。連結代表參照，不代表已授權存取目的地。
`Decision`: `{id,space_id,document_id:string|null,title,body,source_refs:Reference[],actor_id,created_at}`.

- `GET/POST /api/spaces`；只有 manager 可用 `{key,name,description?}` 建立 space。
- `GET /api/spaces/{id}` 會強制檢查 scope。
- `GET /api/documents?space_id=&q=&tag=` 會依範圍提供中繼資料／搜尋。搜尋標題／本文；結果指出版本與引用 URI（允許回傳 `snippet?`、`uri?`、`version?` 等額外中繼資料）。
- `POST /api/documents` `{space_id,title,summary?,body,tags?:[],change_summary?,source_refs?:[]}` 會以原子方式建立 document + 不可變的 version 1，並回傳 DocumentContext。只有 scope 內的 manager／writer 可操作。
- `GET /api/documents/{id}` -> 最新版本的 DocumentContext。
- `GET /api/documents/{id}/versions` -> Version[]；`GET /api/documents/{id}/versions/{n}` -> 精確 Version。
- `POST /api/documents/{id}/versions` `{expected_version,title?,body,change_summary,source_refs?:[]}` 使用 compare-and-swap 比對目前版本，並回傳新建的 Version；expected_version 過期時回傳 409。本文不可為空白。更新後舊版本必須完全不變。
- `GET/POST /api/decisions?space_id=`；建立本文 `{space_id,document_id?,title,body,source_refs?:[]}`。Document 必須屬於同一個已授權 space。
- `GET /api/events?space_id=` 回傳範圍內的稽核清單。

標準引用為 `ordivant://knowledge/spaces/{space_id}/documents/{document_id}/versions/{n}`。本試行版不提供假 embeddings／RAG：使用實際持久化文字搜尋，並明確標示為文字搜尋。

MCP 環境變數為 `ORDIVANT_KNOWLEDGE_API_URL`、`ORDIVANT_KNOWLEDGE_API_TOKEN`。官方 SDK stdio bridge 工具：`list_spaces`、`search_knowledge`、`create_document`、`get_document_context`、`get_document_version`、`publish_document_version`、`record_decision`、`list_decisions`；變更操作可選擇提供 request_id，並對應為 Idempotency-Key。提供精確版本 resources 與 context citation prompt。工具不接受呼叫端提供操作者身分。

Knowledge 驗收：writer 建立 v1；並行發布 v2 時只有一個成功，另一個回傳 409；v1 本文／hash 維持不變；重複發布不會建立 v3；文字搜尋回傳目前內容 + 精確引用；reader 不可寫入；隔離 space 存取會遭拒；保留 task／PR 來源脈絡；程序重新啟動後資料仍持久化；實際執行 SDK 往返流程。

## Code API（連接埠 8020）{#code-api-port-8020}

環境設定：`ORDIVANT_CODE_DATA_DIR` 預設為 repo `/.data/code`；`ORDIVANT_CODE_DATABASE_URL` 為選填；可設定 `ORDIVANT_CODE_GITEA_URL`、`ORDIVANT_CODE_GITEA_TOKEN`、`ORDIVANT_CODE_WEBHOOK_SECRET`，或使用被忽略的 JSON `ORDIVANT_CODE_GITEA_CONFIG`，內容為 `{url,token,webhook_secret}`。進入點為 `python -m ordivant_code.seed`、`uvicorn ordivant_code.main:app`、`python -m ordivant_code.mcp_server`。

`GET /api/health` -> `{status:"ok",product:"code",database,mode,gitea_configured:boolean}`。Health 不發出網路呼叫，也不含憑證。未設定 Gitea 時仍可讀取既有中繼資料；需要 Gitea 的操作回傳 503 `gitea_not_configured`。

`CodeProject`: `{id,key,name,description,organization_id,created_at}`.
`Repository`: `{id,project_id,provider:"gitea",owner,name,default_branch,web_url,clone_url,created_at}`.
`PullRequest`：`{id,repository_id,number,title,body,state:"open"|"closed",head,base,web_url,head_sha,source_refs:Reference[],created_at,updated_at}`。Git／PR 狀態以 Gitea 為準。平台只保存範圍內的參照與收據，不會另外實作一套 Git。
`Check`：`{id,repository_id,commit_sha,context,state:"pending"|"success"|"failure"|"error",description,target_url:string|null,source:"agent_reported"|"gitea_webhook",actor_id,created_at}`。Agent 回報會明確標示來源；不可暗示 CI runner 實際執行過測試。

- `GET/POST /api/projects` 與 `GET /api/projects/{id}` 會強制檢查 scope；建立僅限 manager。
- `GET /api/repositories?project_id=` -> 本機授權範圍內的 repository 清單。
- `POST /api/repositories` `{project_id,name,description?,private?:true}` 使用已設定的 Gitea service account 建立 repo、自動初始化 README 與 main branch，接著保存 binding。回應遺失後重試時，必須以確定的 owner／name 查詢並調和；除非明確的 manager binding 操作已驗證權限，否則拒絕接管未記錄的既有 repository。全域帳號權限不能擴大 Code 專案權限。
- `POST /api/repositories/{id}/branches` `{name,from_branch?:"main"}` 會建立實際 Gitea branch。驗證 branch／path 輸入與 manager／writer scope。同一請求具冪等性；回傳 `{name,commit_sha}`。
- `POST /api/repositories/{id}/files` `{branch,path,content,commit_message,expected_sha?:string}` 呼叫實際的 Gitea Contents API，content 由 UTF-8 轉為 base64；建立／更新操作以現有 sha 防護。回傳 `{path,branch,commit_sha,file_sha}`。回應遺失後重試時，須調和預期內容／commit 或保存持久化意圖；相同 Idempotency-Key 絕不可默默產生重複 commit。
- `GET /api/repositories/{id}/pulls` -> PullRequest[]（若已設定 Gitea，會重新整理）；`POST /api/repositories/{id}/pulls` `{head,base?:"main",title,body?,source_refs?:[]}` 呼叫實際 Gitea PR，並回傳範圍內的 PullRequest。建立前以穩定的 head／base 調和重複請求／回應遺失後重試。
- `GET /api/repositories/{id}/pulls/{number}` -> PR，並附上 `checks:Check[]` 與 source_refs。
- `POST /api/repositories/{id}/checks` `{commit_sha,context,state,description?,target_url?}` 回報實際 Gitea commit status，並持久化明確標示為 agent_reported 的收據。Reader 不能寫入，references 不能擴大存取權。
- `POST /api/webhooks/gitea` 接受原始 JSON；在解析 JSON 前，以原始 bytes 與設定 secret 驗證 `X-Gitea-Signature` HMAC-SHA256；依 `X-Gitea-Delivery` 去重，且本文變更時拒絕重播。只更新 owner／name 完全相符的已綁定 repository。受信任 webhook 可同步 push／pull request 收據中繼資料；絕不可核准 Work task 或合併 PR。
- `GET /api/events?project_id=` 回傳範圍內的稽核資料。

此試行版本不提供 merge／delete 操作。寫入 API 只操作明確選取且受 scope 限制的 binding。Service account 的 Gitea token 絕不回傳給用戶端。Gitea API 仍會強制執行其實際權限；不可宣稱單一本機試行帳號已實現最終企業級逐 Agent ACL 同步。

MCP 環境變數為 `ORDIVANT_CODE_API_URL`、`ORDIVANT_CODE_API_TOKEN`。官方 SDK stdio bridge 工具：`list_code_projects`、`list_repositories`、`create_repository`、`create_branch`、`commit_file`、`create_pull_request`、`get_pull_request`、`report_check`、`get_code_events`；變更操作中的 request_id -> Idempotency-Key。提供 PR context resources。

Code 驗收：使用自有本機開源 Gitea instance；建立 private repo、branch、實際檔案 commit、PR 與 status，再讀取同一個 PR；重複呼叫不會建立額外物件／commit；拒絕偽造 webhook，並對已簽署 delivery 去重；拒絕 reader／隔離專案的存取；缺少 Gitea 不妨礙啟動；回應／稽核／快取不含原始上游 token／secret；實際執行 SDK 往返流程。不可將 CI 收據描述成真的 CI 測試執行結果。

## Frontend 模組與獨立性 {#frontend-modules-and-independence}

新增清楚的 Work／Knowledge／Code 產品切換器；Work 品牌名稱顯示 Ordivant Work。保留已完成的 Work 介面。`/`、`/work` -> Work；`/knowledge` -> Knowledge 工作區；`/code` -> Code 工作區。每個產品只初始化自己的 session／API，即使其他產品停止也能運作。Vite 將 Work `/api`、Knowledge `/knowledge-api` -> port 8010 `/api`、Code `/code-api` -> port 8020 `/api`（target 可設定）。獨立的 `work`、`knowledge`、`code` build mode 可輸出不同成品；standalone mode 可在 `/` 選定產品，並設定自己的 API prefix。

Knowledge 介面：space 選擇器、搜尋／列出文件、精確版本選擇器、安全且易讀的 Markdown／本文、建立／發布（附 expected version 與衝突錯誤）、不可變版本歷程、決策／來源脈絡。Code 介面：專案／repository、明確顯示已設定／未設定狀態、建立 repository／branch／commit／PR、讀取 PR／checks，並明確標示回報的 status 為自我回報。提供各自獨立的 local-session 與手動 token fallback。不可內嵌服務憑證。採清晰克制且一致的設計、支援響應式版面並顯示真實 API 錯誤；除非有助於操作，否則產品 UI 不提內部實作細節。

## 整合驗收與範圍 {#integrated-acceptance-and-scope}

Knowledge v1 -> 帶有精確版本 artifact／reference 的 Work task -> Agent A 委派給 B -> Code 建立自有本機 Git branch／commit／PR，並引用 Work + Knowledge -> 記錄測試證據／status -> 獨立 reviewer 接受 Work 證據 -> Knowledge 發布引用 task／PR 的 v2。每個產品都提供自己的 MCP。另須在兩個 peer 都停止時測試 Work，並參照既有 GitHub／GitLab／通用 VCS；此時仍必須完成一般工作流程。即時企業 VCS 憑證／SSO 與付費模型須作為另外設定的驗收項目，不得捏造測試結果。
