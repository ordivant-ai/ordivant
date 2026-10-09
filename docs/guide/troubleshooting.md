<span id="排除常見問題"></span>
<span id="排除常见问题"></span>

# 排除常見問題 {#troubleshooting}

<span id="啟動與登入"></span>
<span id="启动与登录"></span>

## 啟動與登入 {#startup-and-sign-in}

| 現象 | 原因或檢查方式 | 處理方式 |
|---|---|---|
| Docker Compose 無法啟動 | Docker Engine 未執行，或 Compose v2 未安裝 | 確認 `docker compose version` 可正常執行，並啟動 Docker Desktop 或 Docker Engine。 |
| 服務啟動時 port 已被使用 | 另一個本機程序佔用 port | 在 repository root 的 `.env` 調整 `ORDIVANT_WEB_PORT` 或 `ORDIVANT_GITEA_PORT`，再用相同部署名稱與 profiles 啟動。 |
| 頁面顯示 API 無法連線 | API 尚未健康、映像仍在建置，或選到不同 Compose project | 從 repository root 執行 `docker compose ps` 和 `docker compose logs --tail 100 work-api`。確認使用相同部署名稱、profiles 及 Compose 檔案組合。 |
| 沒看到建立管理員的初始設定 | Identity 資料卷已初始化，或目前指向另一個 Compose project | 執行 `docker compose ls`；預設部署名稱由 `compose.yaml` 設為 `ordivant`。只有自訂名稱時才核對 repository root 的 `.env` 中 `COMPOSE_PROJECT_NAME`。沒有預設帳號；請使用既有管理員或復原流程，不要刪除 volume 來試密碼。 |
| 登入成功但看不到 Project／Space | 人類 session 已建立，但該產品資源範圍尚未授予 | 請 Identity 管理員分配正確產品角色及明確資源 scope。SSO 網域不會自動授予資料存取權。 |

<span id="seed、runtime-與-run"></span>
<span id="seed、runtime-与-run"></span>

## Runtime 與模型設定 {#seed-runtime-and-runs}

| 現象 | 原因或檢查方式 | 處理方式 |
|---|---|---|
| Runtime 無法開始，提示機器身分尚未初始化 | Work API 尚未健康，或 Runtime bootstrap 尚未完成 | 確認 Work API 已啟動，再執行 `docker compose exec work-api python -m ordivant.bootstrap_runtime` 和 `docker compose --profile runtime up -d --build --wait runtime`。此初始化不需要 Seed，也不會建立人員或專案；有效的 `runtime_token` 不會被輪替。 |
| 看不到示範資料 | Seed 是選配；新環境預設不建立 DEMO | 只有全新且尚無任何真實資料的試用環境，才可在 Runtime bootstrap 前建立 DEMO。請依[維運與備份](operations.md)選擇單一產品的 Seed 命令；既有部署不可執行 Seed。 |
| Run 停留在 queued/waiting | Runtime 未啟動、Agent 不符合能力／scope、前置 Task 尚未被接受，或沒有可用 Agent | 執行 `docker compose --profile runtime ps` 及 `docker compose --profile runtime logs --tail 100 runtime`；檢查 Agent 角色、Project scope、能力和 workflow dependency/review 狀態。使用 Sandbox 時，命令也需沿用 `-f compose.yaml -f compose.sandbox.yaml`。 |
| 執行結果標示 DEMO | 尚未為組織或 Agent 配置有效的模型連線 | 由管理員在 Work 模型管理頁設定 provider、API key 和 model，再確認 Agent 設定並重新派發。DEMO 不代表已使用付費模型。 |
| Stop 後上游工具結果不明 | Stop 會撤銷 Run 寫入權；外部服務可能已執行副作用 | 先到該上游服務核對實際結果，再決定是否建立新 Run。系統不會自動重播不確定的外部操作。 |

<span id="knowledge、code-與-sso"></span>
<span id="knowledge、code-与-sso"></span>

## Knowledge、Code 與 SSO {#knowledge-code-and-sso}

| 現象 | 原因或檢查方式 | 處理方式 |
|---|---|---|
| Knowledge 搜尋找不到語意相近的內容 | 目前是標題／正文文字搜尋，非向量或 RAG 搜尋 | 使用正文確切詞彙、文件標題或 tag 篩選；確認有讀取該 Space 的權限。 |
| 發佈 Knowledge 版本回報衝突 | 預期版本已被其他 writer 更新 | 載入最新版本，檢查變更和引用，再基於最新版本重新編輯、發佈。既有版本不會被覆寫。 |
| Code 可讀但不能建立 repository／PR | Gitea profile 未啟動、初始化未完成，或 Code API 尚未重新連接 Gitea | 依下方命令啟動與初始化 Gitea，再重建 Code API。不要把 Gitea service credential 放入瀏覽器。 |
| PR 有 status 但無法確認測試曾執行 | `agent_reported` 是提交狀態收據，不是 CI runner 執行記錄 | 檢查收據來源；只有實際可驗證的 Gitea webhook 或外部測試系統才代表其對應事件，不要把回報寫成 CI 結果。 |
| OIDC callback 或登入循環失敗 | IdP Redirect URI 與管理介面顯示的 Callback URL 不完全一致，或 canonical HTTPS origin／cookie 設定不符 | 核對完整 callback URL、Issuer、允許網域及可信 public origin；先用一位成員驗證再改登入政策。設定步驟見[企業登入說明](../enterprise-sso.md)。 |

啟用 Gitea 時，請在 repository root 使用預設的同一 Compose project 執行：

```sh
docker compose --profile gitea up -d --wait gitea
docker compose -f compose.yaml -f compose.gitea-init.yaml --profile gitea run --rm gitea-init
docker compose up -d --no-deps --force-recreate --wait code-api
```

<span id="資料與服務目錄"></span>
<span id="数据与服务目录"></span>

## 資料與服務目錄 {#data-and-service-directories}

- 預設 Compose 專案名稱為 `ordivant`，由 `compose.yaml` 固定。若使用自訂 `.env`，確認 `COMPOSE_PROJECT_NAME` 與原部署相同；可用 `docker compose ls` 查看已啟動的專案。
- `docker compose down` 會保留資料；`docker compose down -v` 會刪除 volumes 並造成資料遺失。不要將刪除 volume 當成一般排障步驟。
- 不要直接把預設的 `.data/container-secrets/`、自訂 `ORDIVANT_SECRETS_DIR`、bootstrap 資料、IdP client secret 或 Gitea 設定貼到日誌或 issue。分享 Docker logs 前也要先檢查是否含機密。
- 備份需包含資料庫、data volumes 和對應 encryption keys。操作步驟見[維運與備份](operations.md)。
- Work/Knowledge/Code 各自有服務與資料邊界；一個產品健康不代表其他產品也可用。先查看產品自身 health/status，再檢查共用 Identity 或依賴服務。
- 啟用 Sandbox 時，後續每個 Compose 命令都必須使用安裝時相同的 `-f compose.yaml -f compose.sandbox.yaml` 檔案組合及相同 profiles。
