# 維運與備份

本機與容器的服務生命週期由 `scripts/containers.ps1` 控制。第一次操作時指定穩定的 `-ProjectName`；helper 以該名稱隔離 Compose project、named volumes 和 `.data/container-secrets/<ProjectName>`。從另一個 clone 啟動時，明確使用同一個名稱才能找到原資料。

## 服務狀態與更新

```powershell
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action status
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev -Action logs -WithRuntime -WithGitea -WithSandbox
pwsh -NoProfile -File .\scripts\containers.ps1 -Development -ProjectName ordivant-dev
```

每次需以相同的 Development／production 模式和 project name 呼叫 helper。查看 `logs` 時，帶上要檢查的 optional profile 選項；`down` 會納入 optional profiles 並停止該 Compose project。它保留 volumes 和 secret files，不是備份。刪除 Compose project volumes 會永久刪除該 project 的資料。

開發 Web 預設綁定 loopback `5173`，Gitea 預設 `3002`；可分別用 `ORDIVANT_DEV_WEB_PORT` 和 `ORDIVANT_GITEA_PORT` 避開主機 port 衝突。開發 helper 預設也只把其 API ports 綁定 loopback。Production Web 預設 `8088`，對外部署需自行配置 HTTPS reverse proxy、canonical origin 和 secure cookies。

## 需要備份的資料

備份時以 Compose project label 找出該環境的所有 volumes，依資料庫產品與 data volume 作為同一組保存。典型完整套件包含：

| 區域 | Compose volumes / host files | 內容 |
|---|---|---|
| Identity | `identity_postgres`、`identity_data` | 人員、session、SSO 設定與 `sso.key` |
| Work | `work_postgres`、`work_data` | Work 任務、Agent、Run、Runtime 狀態及 `model-settings.key` |
| Knowledge | `knowledge_postgres`、`knowledge_data` | Space、文件版本、決策與範圍資料 |
| Code | `code_postgres`、`code_data` | Code scopes、Repository binding、PR 和 status receipts |
| Gitea（若啟用） | `gitea_data` | Repository、branch、commit、PR 的實際 Git 資料 |
| Keycloak broker（若啟用） | `identity_broker_postgres` | Broker realm 與連線設定 |
| Compose secrets | `.data/container-secrets/<ProjectName>/` | DB password/URL、內部服務 token、Gitea 與其他服務設定 |

實際 volume 清單依啟用產品和 profiles 而異。Work 的 `model-settings.key` 用於解密模型和 MCP tool connection 設定；Identity 的 `sso.key` 用於解密企業 IdP 設定。加密 key 必須與對應資料庫、data volume 一起備份，不能單獨換新，否則舊密文無法解密。Runtime 的 Pi 狀態位於 Work data volume。每次 sandbox 的工作目錄是暫時資料，不作為成果保存位置。

在 Docker Desktop 或 Docker CLI 中，可用 project label 找到這個環境實際建立的 volume 名稱：

```powershell
docker volume ls --filter "label=com.docker.compose.project=ordivant-dev"
```

將列出的所有產品、Identity 和已啟用 profile volumes 納入備份；實際清單以此命令結果為準，不要只依照範例名稱猜測。

## 一致性與還原

1. 確認備份目標是正確的 Compose project name。用 `-Action down` 停止該環境，讓檔案與 PostgreSQL volume 保持一致；這不會刪除資料。
2. 使用你組織核准的 Docker volume snapshot／備份工具，備份該 project label 下需要的全部 volumes。也一併保存同 project 的 ignored `container-secrets` 目錄。
3. 將備份與 host secrets 目錄加密保存，限制存取並定期測試還原。不要把 `.data`、bootstrap token 或 Gitea/service credential 上傳到公開 issue、聊天或 Git。
4. 還原時先恢復同名 Compose volumes 和原 secrets，再使用同一 project name 與原產品/profile 啟動。不要將不同環境的加密 key 和資料庫混用。

若使用單產品或部分產品模式，備份該模式建立的所有 volumes 及共用 Identity volumes。Knowledge 引用和 Code PR provenance 不會代替目的產品資料備份；需一併保存來源產品及實際 Gitea 資料。

## 執行與排程

Interval workflow 需要 Work Runtime 持續運行。停止期間錯過的排程不會全部補跑；同一排程的 active workflow 會阻止重疊。每次沙箱 workspace 都有界限並在 Run 結束清理，不應用作持久檔案儲存。Run、artifact 和 Knowledge 文檔要透過產品本身保存。

執行控制、允許工具 host 和沙箱限制見[執行使用指南](../execution-usage.md)。Runtime 未配置有效模型時使用 DEMO fallback；DEMO 不是付費模型或費率估算。
