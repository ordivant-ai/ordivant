# Changelog

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
