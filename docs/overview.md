<span id="專案介紹"></span>
<span id="项目介绍"></span>

# 專案介紹 {#project-overview}

Ordivant 是開源、可自行部署的 Agent 專案協作平台，介面以繁體中文呈現。設計重點是團隊權限、可追溯規格、Agent 協作、真實執行證據及獨立審查。

<span id="四個服務邊界"></span>
<span id="四个服务边界"></span>

## 四個服務邊界 {#four-service-boundaries}

| 服務 | 責任 | 可選的執行依賴 |
| --- | --- | --- |
| Work | 專案、任務、Agent、執行與工作流程 | Pi Durable 執行環境、Docker 沙箱 |
| Knowledge | 文件版本、決策、搜尋與引用 | 不需要 Work runtime |
| Code | 版控中繼資料、Gitea 寫入與 webhook | Gitea；未設定時明確拒絕 Git 寫入 |
| Identity | 人員帳號、session、SSO、權限 | Keycloak broker 用於 SAML／LDAP／AD |

各產品都有自己的 Python API、資料庫與 MCP 入口。React 介面可建置為 Suite 或單一產品；各產品透過 API 連結，不會直接查詢彼此的業務資料庫。

<span id="完成與證據"></span>
<span id="完成与证据"></span>

## 完成與證據 {#completion-and-evidence}

任務、Execution 與 Run 是不同紀錄。Run 完成表示執行與提交完成；任務需由獲授權的獨立審查者接受成果後才算完成。模型自我回報的成本、合成 DEMO 與實際 Provider 回傳的用量會明確區分；未知費用仍標示為未知。

<span id="適用與限制"></span>
<span id="适用与限制"></span>

## 適用與限制 {#intended-use-and-limits}

適合需要自行管理資料及服務的小型團隊、Agent 協作實驗與企業試點。v0.1 由單一 runtime 擁有 Pi 儲存；多節點執行、高負載，以及各企業自己的 IdP／Git／模型供應商都應另行驗證。完整限制見[路線圖](./roadmap.md)，公開狀態見[版本說明](./release.md)。
