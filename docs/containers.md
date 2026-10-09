# 容器開發與部署 {#container-workflow}

`scripts/containers.ps1` 會透過 Docker Compose 建置並執行選定的產品。主機需要 Docker Engine／Desktop 與 Docker Compose，不需要安裝 `uv`、Python、Node.js 或 npm。

## 開發環境 {#development}

以下命令會啟動完整開發套件，明確建立本機示範資料，並啟用選配的 Gitea 與 Pi runtime 服務：

```powershell
.\scripts\containers.ps1 -Development -Seed -WithGitea -WithRuntime
```

輔助腳本會建置選定產品的開發映像，等待 API 與網頁服務就緒；只有提供 `-Seed` 時才初始化選定 API 的資料，提供 `-WithGitea` 時才初始化本機 Gitea 服務帳號。Work 已有初始化檔後，才會啟動 runtime。已設定模型的 Work 派發會使用實際模型連線；尚未設定的派發會使用有明確示範標示、結果固定的備援模式。詳見[模型設定](model-usage.md)。

開發模式會將產品原始碼掛載到容器中，並提供與正式環境相同的完整帳號登入。無論選擇哪一個產品，都會包含 Identity API `8030` 與其獨立 PostgreSQL。預設主機連接埠為 Work API `8000`、Knowledge API `8010`、Code API `8020`、網頁 `5173`、runtime `8090`，以及 Gitea `3002`。若連接埠已被使用，可在 shell 中覆寫 Compose 的連接埠變數。

若只要執行單一產品的獨立前端與 API，而不啟動其他產品：

```powershell
.\scripts\containers.ps1 -Development -Products knowledge -Seed
.\scripts\containers.ps1 -Development -Products code -Seed -WithGitea
```

選擇單一產品時，腳本會將 `ORDIVANT_PRODUCT_MODE` 設為該產品，並將網頁的 API 上游指向對應 API 容器。支援單一產品、全部三個產品，以及包含 Work 的兩產品組合。只有 Knowledge＋Code 的組合會被拒絕，因為套件路由需要 Work 作為 `/api` 的上游。支援的多產品組合會使用套件模式，並將 `/api` 導向 `work-api`。

## 正式環境映像 {#production-targets}

首次啟動時，網頁會要求使用者自行設定密碼並建立初始管理員。平台沒有預設的人類帳號；`-Seed` 只會建立業務示範資料與 Agent 憑證。開發與正式環境使用不同的 Identity 資料卷，以及各自 Compose 專案的 Cookie 名稱。邀請、權限、密碼復原與撤銷工作階段的方式，請參閱[帳號與登入](human-login.md)。所有已設定的產品都會在兩種模式中拒絕舊的本機工作階段端點。

除非明確提供設定，腳本會依選定的網頁主機連接埠推導精確的 `ORDIVANT_AUTH_ORIGINS`。遠端 HTTPS 部署需設定公開來源，以及 `ORDIVANT_AUTH_COOKIE_SECURE=true`。只有明確使用 HTTP 回送位址的來源可使用非安全 Cookie。Identity 服務秘密與資料庫連線檔保存在各專案已被 Git 忽略的秘密資料夾中。

不加 `-Development`，即可建置並執行正式環境 Docker 映像。本機工作階段驗證仍保持停用：

```powershell
.\scripts\containers.ps1 -Action up
.\scripts\containers.ps1 -Action up -Products knowledge
```

選擇完整套件時，會使用套件前端模式，並以 Work 作為 `/api` 上游。單獨選擇 Knowledge 或 Code 時，會建置該產品的獨立前端。正式環境預設網頁連接埠為 `8088`。開發與正式環境的預設 Compose 專案名稱都包含儲存庫絕對路徑的雜湊，因此另一份 checkout 會取得獨立的專案與秘密資料夾。可使用 `-ProjectName` 指定固定的執行個體名稱。

若要同時執行開發與正式環境，請使用不同的 Compose 專案名稱及不衝突的主機連接埠。以下命令只是範例；請依部署名稱、可用連接埠與是否需要 Gitea 調整：

```powershell
$env:ORDIVANT_DEV_WEB_PORT = '5173'
$env:ORDIVANT_WEB_PORT = '8088'
$env:ORDIVANT_GITEA_PORT = '3003'
.\scripts\containers.ps1 -Development -ProjectName ordivant-dev-example -Seed -WithGitea -WithRuntime
Remove-Item Env:ORDIVANT_GITEA_PORT
.\scripts\containers.ps1 -ProjectName ordivant-prod-example -WithGitea
```

這兩次執行會使用各 Compose 專案獨立的資料卷，以及 `.data/container-secrets/<ProjectName>/` 資料夾。正式環境的命令不會建立示範資料。

## 操作與資料保存 {#actions-and-data}

`-Action` 支援 `up`（預設）、`down`、`status` 與 `logs`。操作同一專案時，請使用相同的 `-Development` 與 `-ProjectName` 值。例如：

```powershell
.\scripts\containers.ps1 -Development -Action status
.\scripts\containers.ps1 -Development -Action logs -WithGitea -WithRuntime
.\scripts\containers.ps1 -Development -Action down
```

`down` 只會停止選定的 Compose 專案，並保留其具名資料庫、產品、runtime 與 Gitea 資料卷。腳本不會使用 `down -v`，也不會刪除秘密或資料。

必須明確提供 `-Seed` 才會在各選定產品的 API 容器內執行資料初始化模組。初始化資料及產生的 Bearer token 都是本機示範資料，不會設定企業 SSO。若使用 `-WithRuntime` 卻沒有提供 `-Seed`，腳本會要求該 Compose 專案的永久資料卷中已存在 Work `/data/bootstrap.json`；檔案不存在時會失敗，不會自行建立。

使用 `-WithRuntime` 時，`-Products` 必須包含 `work`。`-WithGitea` 會啟動 `gitea` profile，預設將 Gitea 公開於回送連接埠 `3002`。輔助腳本會初始化本機 Gitea 服務身分，並將必要的服務憑證保存在該 Compose 專案的本機機密資料夾。重複執行時會驗證並保留既有憑證；若無法驗證，腳本會停止，不會悄悄更換憑證。

`-WithSandbox` 另外要求 Work 與 `-WithRuntime`。它會加入 `compose.sandbox.yaml`、建置固定的沙箱工作映像，並在 runtime 之前啟動內部受信任的執行器。只有 `sandbox-api` 持有 Docker daemon socket；工作容器、runtime 與網頁都不持有。沙箱工作以非 root 身分執行，採唯讀、禁止網路及資源限制設定，每次執行使用獨立且容量受限的 tmpfs 工作空間。產生的服務憑證保存在專案機密資料夾。執行控制、範本、工作流程排程與端點主機政策，請參閱[執行功能操作指南](execution-usage.md)。沙箱工作空間內容是暫存資料，不包含在資料卷備份中。

每個 Compose 專案都有獨立的資料卷與機密資料夾。這些機密檔案已被 Git 忽略；請勿提交或公開。若要保留並還原對應資料庫，請將該專案的資料卷、機密資料夾及 Identity 加密金鑰一起安全備份。停止容器不會刪除這些資料。

正式環境建置使用 `ORDIVANT_MODE=production`，不提供本機工作階段驗證。明確使用 `-Seed` 仍會寫入示範身分與本機 Bearer 憑證，因此只有需要示範資料時才應使用。

分享 Docker Compose 錯誤輸出前，請先確認內容未包含機密、個人資料或內部網址。

## Gitea 網址 {#gitea-urls}

Code 在 Compose 網路中連線至 `http://gitea:3000`。瀏覽器與 clone 網址使用 Gitea 設定的 `ROOT_URL`；`PUBLIC_URL_DETECTION=never` 可避免內部 API 請求將這些連結改為 `gitea:3000`。部署到其他主機時，請將 `ORDIVANT_GITEA_PUBLIC_URL` 設為預定公開的 Gitea 網址。預設仍使用 `ORDIVANT_GITEA_PORT` 的回送網址。詳見 [Gitea 官方伺服器設定](https://docs.gitea.com/administration/config-cheat-sheet/#server-server)。

Work 使用各專案自己的 `/data/vcs.json` 存取既有 VCS。其 Compose 設定明確允許私人 HTTP 主機 `gitea`；其他 HTTP 主機必須加入操作者設定的 `ORDIVANT_VCS_HTTP_HOSTS` 允許清單。呼叫者不能透過任務或工具請求指定伺服器網址。

## 企業身分代理 {#enterprise-identity-broker}

共用 Identity 服務支援直接 OIDC 連線，不需額外容器。請在「帳號與安全」中設定身分服務；每個 Compose 專案保有自己的加密設定與身分紀錄。備份 Identity 資料庫時，也必須保留 `identity_data/sso.key`。管理員需從精確信任的驗證來源中選擇正式的 `ORDIVANT_SSO_PUBLIC_ORIGIN`。

如需 SAML 或 LDAP／AD 身分聯邦，可加入選配的 Keycloak 26.8.0 代理與其獨立 PostgreSQL：

```powershell
.\scripts\containers.ps1 -Development -WithIdentityBroker
.\scripts\containers.ps1 -Development -Action status -WithIdentityBroker
```

代理綁定回送連接埠 `8093`；需要調整時，請在啟動前覆寫 `ORDIVANT_BROKER_PORT` 與 `ORDIVANT_BROKER_PUBLIC_URL`。代理沒有預設的人類管理員。請依[企業 SSO](enterprise-sso.md)的互動提示初始化 broker 管理員，並在建立正式管理員後移除暫時帳號。請勿將密碼放入命令、環境變數或檔案。`-WithIdentityBroker` 會設定明確的內部反向通道路由；外部 IdP 使用經驗證的 HTTPS。企業私人 CA 憑證組合可掛載至容器，並透過 `ORDIVANT_SSO_CA_BUNDLE` 指定。

## 無需主機 Python 的 MCP {#mcp-without-host-python}

每個 API 映像都包含自己的 stdio MCP 伺服器。設定 MCP 用戶端時，使用對應專案的 Compose 檔案與限定權限的 token 環境變數來執行 `docker`。主機不需要 Python 環境或 Pi runtime。例如，以下命令會轉送已在用戶端程序環境中設定的 token，其值不會出現在命令參數中：

```powershell
$env:ORDIVANT_SECRETS_DIR = Join-Path (Get-Location) '.data/container-secrets/ordivant-example'
docker compose -p ordivant-example -f compose.yaml -f compose.dev.yaml exec -T -e ORDIVANT_KNOWLEDGE_API_TOKEN knowledge-api python -m ordivant_knowledge.mcp_server
```

外部 MCP 用戶端的設定需使用該部署的 Compose 專案名稱與 Compose 檔案路徑。Work 使用 `ORDIVANT_API_TOKEN` 與 `python -m ordivant.mcp_server`；Knowledge 使用 `ORDIVANT_KNOWLEDGE_API_TOKEN` 與 `python -m ordivant_knowledge.mcp_server`；Code 使用 `ORDIVANT_CODE_API_TOKEN` 與 `python -m ordivant_code.mcp_server`。每個 Agent 應取得其產品限定權限的憑證；不要將 Gitea 服務 token 當成 Ordivant Bearer token。
