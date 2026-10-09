# Changelog

## Unreleased

- 統一成果證據、任務規格、協作訊息、Run 回覆、Knowledge 決策及 PR 描述的 Markdown 顯示；支援清單、表格與程式碼區塊，並更新三語審核截圖。
- 新增三語功能導覽、完整第一個專案教學與團隊設定指南；首頁補充實際工作情境、交付範例及操作路徑。
- 文件加入可切換的產品導覽及可放大、查看原始尺寸的實際截圖，涵蓋 Agent、模型、範本、工作流程、工具與獨立審核。
- 文件首頁補充產品用途、操作情境、第一個任務流程與三語實際介面截圖；公開導覽聚焦使用者及部署管理員。
- 以原生 Docker Compose 初始化服務機密與 Gitea；Runtime 機器身分可獨立初始化，正式安裝無須加入 DEMO 資料。
- 任務詳細資料新增 Pi Agent 派發入口，使用既有權限與冪等 API，並與人工認領操作分開。
- 平台與 GitHub Pages 提供繁體中文、簡體中文及英文；登入、三產品、Run、自動化、模型／工具／SSO 管理可切換語言。
- 瀏覽器語言偏好、跨分頁同步、日期／數字格式與 Ant Design 元件語系整合；使用者內容保持原文。
- 完整對應文件路由、各語言搜尋、翻譯詞條／插值檢查與語言行為回歸檢查。
- 補齊容器、契約、驗收紀錄與專案計畫的三語正文，加入全文件漏翻檢查、共用章節識別碼與舊書籤相容處理。
- 原始碼遷至 `ordivant-ai/ordivant`；文件站使用 `https://ordivant-ai.github.io/`，由專用倉庫建置與發布。

## 0.1.0 — 2026-10-08

首次公開版本，提供可自行部署的 Ordivant Suite：

- **Work**：專案與規格任務、認領／租約、Agent 求助與委派、成果證據、獨立驗收、REST/MCP 與稽核。
- **Run**：Pi Durable 執行、事件與真實用量收據、工具邊界暫停／繼續、停止／重跑、重啟恢復及歷史。
- **自動化**：不可變 Agent／工作流程範本、DAG 依賴、獨立 review 後派工、手動及分鐘間隔排程。
- **工具**：Streamable HTTP MCP、加密 Bearer credential、主機及工具白名單、每次 Run 的受限 Docker 沙箱。
- **Knowledge**：不可變文件版本、文字檢索、精確版本引用、決策及來源追溯。
- **Code**：選配 Gitea 整合、真實 Git/PR 操作及簽章 webhook；Work 支援直接讀取既有 Git provider。
- **Identity**：人員帳號、session、邀請／復原／停用、企業 OIDC、權限群組及可選 Keycloak SAML/LDAP broker。
- **交付**：Docker 開發與部署、各產品獨立建置、公開 CI、GitHub Pages 文件與 MIT 授權。

### 已知邊界

這是早期公開版本；企業自己的 IdP、私有 Git 及模型連線需各自驗證。尚未提供 SCIM、硬性金額預算、內建外部 CI runner、互動式 MCP OAuth 或 VM 沙箱。Knowledge 的搜尋是文字檢索。詳見 [路線圖](docs/roadmap.md) 與 [驗收紀錄](docs/validation.md)。
