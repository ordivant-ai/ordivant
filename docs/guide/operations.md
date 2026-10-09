<span id="維運與備份"></span>
<span id="运维与备份"></span>

# 維運與備份 {#operations-and-backups}

本機與容器服務的生命週期由 `scripts/containers.ps1` 控制。初次操作請指定固定的 `-ProjectName`；此指令碼會依該名稱隔離 Compose 專案、具名資料卷及 `.data/container-secrets/<ProjectName>`。從另一份 Git 工作副本啟動時，必須明確使用相同名稱，才能連接到原有資料。

<span id="服務狀態與更新"></span>
<span id="服务状态与更新"></span>

## 服務狀態與更新 {#service-status-and-updates}

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action status
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action logs -WithRuntime -WithGitea -WithSandbox
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev
```

每次呼叫指令碼時，都要使用相同的開發或正式模式及專案名稱。查看 `logs` 時，加入要檢查的選用服務設定檔參數；`down` 會一併處理已啟用的選用設定檔，並停止該 Compose 專案。它會保留資料卷和機密檔案，但不等於備份。刪除 Compose 專案的資料卷會永久刪除該專案的資料。

開發版 Web 預設只監聽本機迴環位址（loopback）的 `5173` 連接埠；Gitea 預設使用 `3002`。若主機連接埠衝突，可分別設定 `ORDIVANT_DEV_WEB_PORT` 和 `ORDIVANT_GITEA_PORT`。開發指令碼也會讓 API 連接埠僅監聽本機迴環位址。正式版 Web 預設使用 `8088`；對外部署時，請自行設定 HTTPS 反向代理、正式網站來源及安全 Cookie。

<span id="需要備份的資料"></span>
<span id="需要备份的数据"></span>

## 需要備份的資料 {#data-to-back-up}

備份時以 Compose project label 找出該環境的所有 volumes，依資料庫產品與 data volume 作為同一組保存。典型完整套件包含：

| 區域 | Compose 資料卷／主機檔案 | 內容 |
|---|---|---|
| Identity | `identity_postgres`、`identity_data` | 人員、工作階段、SSO 設定與 `sso.key` |
| Work | `work_postgres`、`work_data` | Work 任務、Agent、Run、Runtime 狀態及 `model-settings.key` |
| Knowledge | `knowledge_postgres`、`knowledge_data` | Space 文件版本、決策與範圍資料 |
| Code | `code_postgres`、`code_data` | Code 範圍、repository 綁定、PR 與狀態收據 |
| Gitea（若啟用） | `gitea_data` | Repository、分支、提交、PR 的實際 Git 資料 |
| Keycloak broker（若啟用） | `identity_broker_postgres` | Broker realm 與連線設定 |
| Compose 機密 | `.data/container-secrets/<ProjectName>/` | 資料庫密碼／URL、內部服務 token、Gitea 與其他服務設定 |

實際資料卷清單會依啟用的產品和設定檔而異。Work 的 `model-settings.key` 用於解密模型及 MCP 工具連線設定；Identity 的 `sso.key` 用於解密企業 IdP 設定。加密金鑰必須與對應資料庫及資料卷一起備份，不可單獨更換，否則無法解密既有密文。Runtime 的 Pi 狀態位於 Work 資料卷。每次 sandbox 的工作目錄都是暫存資料，不是成果保存位置。

在 Docker Desktop 或 Docker CLI 中，可用 Compose 專案標籤查出此環境實際建立的資料卷名稱：

```powershell
docker volume ls --filter "label=com.docker.compose.project=ordivant-dev"
```

請將列出的所有產品、Identity 及已啟用設定檔的資料卷納入備份；實際清單以此命令結果為準，不要只依範例名稱猜測。

<span id="一致性與還原"></span>
<span id="一致性与还原"></span>

## 一致性與還原 {#consistency-and-restoration}

1. 確認備份目標是正確的 Compose 專案名稱。使用 `-Action down` 停止該環境，讓檔案資料與 PostgreSQL 資料卷保持一致；這不會刪除資料。
2. 使用組織核准的 Docker 資料卷快照或備份工具，備份該專案標籤下需要的全部資料卷。也要一併保存同一專案中被 Git 忽略的 `container-secrets` 目錄。
3. 將備份和主機上的機密目錄加密保存、限制存取，並定期測試還原。不要把 `.data`、初始設定 token 或 Gitea／服務憑證上傳到公開 issue、聊天或 Git。
4. 還原時先恢復同名 Compose 資料卷及原有機密，再使用相同專案名稱與原產品／設定檔啟動。不要混用不同環境的加密金鑰和資料庫。

若使用單一產品或部分產品模式，請備份該模式建立的所有資料卷及共用 Identity 資料卷。Knowledge 引用和 Code PR 的來源追溯資訊不能代替目標產品資料備份；也需保存來源產品及實際 Gitea 資料。

<span id="執行與排程"></span>
<span id="运行与调度"></span>

## 執行與排程 {#execution-and-scheduling}

定期間隔工作流程需要 Work Runtime 持續執行。服務停止期間錯過的排程不會全部補跑；同一排程已有進行中的工作流程時，不會重疊啟動。每次沙箱工作區都有資源界限，並在 Run 結束時清理，不應用來長期保存檔案。Run、成果物和 Knowledge 文檔請透過相應產品保存。

執行控制、工具允許連線的主機及沙箱限制見[執行使用指南](../execution-usage.md)。Runtime 未設定有效模型時會使用 DEMO 後備模式；DEMO 不代表付費模型執行，也不是費率估算。
