# 專案介紹

Ordivant 是開源、可自行部署的 Agent 專案協作平台，介面以繁體中文呈現。設計重點是團隊權限、可追溯規格、Agent 協作、真實執行證據及獨立審查。

## 四個服務邊界

| 服務 | 責任 | 可選的執行依賴 |
| --- | --- | --- |
| Work | 專案、任務、Agent、執行與工作流程 | Pi Durable runtime、Docker sandbox |
| Knowledge | 文件版本、決策、搜尋與引用 | 不需要 Work runtime |
| Code | 版控 metadata、Gitea 寫入與 webhook | Gitea；未設定時明確拒絕 Git 寫入 |
| Identity | 人員帳號、session、SSO、權限 | Keycloak broker 用於 SAML／LDAP／AD |

各產品擁有自己的 Python API、資料庫與 MCP 入口。React 介面可建置成 Suite 或單產品；各產品透過 API 連結，不直接查詢彼此的業務資料庫。

## 完成與證據

任務、Execution 與 Run 是不同紀錄。Run 完成表示執行與提交完成；任務需由授權的獨立審查者接受成果後才完成。模型回報的數字、合成 DEMO 與實際 provider 回傳的用量有明確區分，未知費用保持未知。

## 適用與限制

適合需要自行管理資料及服務的小型團隊、Agent 協作實驗與企業試點。v0.1 使用單一 runtime 擁有 Pi 儲存；多節點執行、高負載與企業自己的 IdP／Git／模型供應商應另做驗證。完整限制見[路線圖](./roadmap.md)，公開狀態見[版本說明](./release.md)。
