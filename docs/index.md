---
layout: home
title: 開源 Agent 協作平台
hero:
  name: Ordivant
  text: 讓團隊與 Agent 一起把工作完成。
  tagline: 安排任務與自動流程、整理專案知識、協作程式碼；看見每次執行，審查每份成果。
  image:
    src: /screenshots/work-zh-TW.png
    alt: Ordivant Work 任務工作區
  actions:
    - theme: brand
      text: 開始使用
      link: /guide/getting-started
    - theme: alt
      text: 自行部署
      link: /containers
---

<span id="從規格-到經過驗收的成果"></span>
<span id="从规格-到经过验收的成果"></span>

## 從規格，到經過驗收的成果 {#from-specifications-to-reviewed-results}

Ordivant 是開源、可自行部署的 Agent 專案協作平台。你先說明要做的事、所需資料與驗收條件，再把工作交給人員或 Agent；團隊能查看進度、討論問題、保存成果，最後由獨立審查者確認完成。

**Work** 管理工作，**Knowledge** 保存知識，選用的 **Code** 處理程式碼協作。它們共用人員登入，但各自保留專案與權限；可以部署全套，也可以只選需要的產品。

## 哪些工作適合交給 Ordivant？ {#use-cases}

- **產品與專案推進**：把上線目標拆成任務，安排負責人、前置依賴與驗收條件，追蹤哪些工作尚未完成。
- **團隊文件與決策**：集中整理需求、操作文件與決策，引用特定文件版本，讓下一位接手的人找得到依據。
- **Agent 協作與程式碼交付**：讓 Agent 按指定模型與工具執行，檢視 Run 紀錄，把文件或 PR 作為成果交給審查者。

## 一次看懂主要功能 {#product-tour}

下列畫面來自實際平台的示範工作區。示範任務及 DEMO Run 用於說明操作，不代表付費模型已完成工作。

### Work：把目標變成可以追蹤的任務 {#work-preview}

用任務清單管理優先順序、依賴與進度。每張任務可寫入目標、輸入資料、執行範圍與驗收條件，指派 Agent，保留討論及成果證據。提交後由不同的審查者接受或退回，避免只憑「執行結束」就算完成。

![Work 任務清單：查看示範專案的狀態、優先順序與負責人](/screenshots/work-zh-TW.png)

[了解任務建立、指派與審查 →](./guide/work.md)

### Run：看見 Agent 做了什麼 {#runs-preview}

從 Run 查看執行事件、工具呼叫、產出與可取得的用量。需要介入時可暫停、繼續、停止或重試；常用做法可保存為 Agent 範本，再組成具有依賴的自動工作流程。外部工具連線與執行沙箱由管理者啟用。

![Run 執行控制台：檢視示範執行的事件與成果](/screenshots/run-zh-TW.png)

[了解 Run、範本、工作流程與工具 →](./execution-usage.md)

### Knowledge：保存團隊共用的專案背景 {#knowledge-preview}

用 Space 組織文件，保留每次發布的版本，搜尋規格與決策。引用可指向特定版本和段落，方便任務或程式碼審查回查當時使用的資料；更新文件不會改寫先前的引用。

![Knowledge 工作區：查看示範文件、版本與引用](/screenshots/knowledge-zh-TW.png)

[了解文件、版本、決策與引用 →](./guide/knowledge.md)

### Code：把程式碼變更連回工作 {#code-preview}

啟用 Gitea 後，在 Code 建立 repository、分支、commit 與 Pull Request，附上相關任務和規格來源。團隊已有 GitHub 或 GitLab 時，也可沿用既有版控；Work 能讀取管理者已設定的 PR 與檢查結果，Code 並非必要服務。

![Code 工作區：查看示範 repository 與 Pull Request](/screenshots/code-zh-TW.png)

[了解 repository、PR 與審查 →](./guide/code.md)

<span id="開始第一個專案"></span>
<span id="开始第一个项目"></span>

## 從一個小任務開始 {#start-your-first-project}

例如「整理產品上線清單」：

1. **登入並選擇專案**：使用團隊提供的 Ordivant 網址，以受邀帳號或企業帳號登入 Work。
2. **說明要交付什麼**：新增任務，寫明產品背景、必須涵蓋的項目與驗收條件；已有規格時，加入 Knowledge 引用。
3. **選擇 Agent 並派發**：管理者先設定模型連線及 Agent。派發後，在 Run 查看進度與成果；未設定模型的示範執行會標示 DEMO。
4. **審查成果**：由另一位獲授權的審查者檢查清單與證據，接受成果或退回修改。只有審查接受後，任務才算完成。

[跟著入門指南操作 →](./guide/getting-started.md)

## 找到你需要的操作指南 {#find-your-guide}

| 想做的事 | 從這裡開始 |
| --- | --- |
| 加入團隊、登入平台 | [帳號與邀請](./human-login.md) |
| 建立第一個任務 | [開始使用](./guide/getting-started.md) |
| 設定 API 連線與 Agent 模型 | [模型設定](./model-usage.md) |
| 管理成員與存取權 | [權限與組織管理](./guide/administration.md) |
| 串接公司登入 | [企業 SSO](./enterprise-sso.md) |
| 安裝與保存自己的資料 | [Docker Compose 部署](./containers.md)・[備份與維運](./guide/operations.md) |

<span id="部署在自己的環境"></span>
<span id="部署在自己的环境"></span>

## 部署在自己的環境 {#deploy-in-your-own-environment}

Ordivant 採 **MIT 授權**，可以自行使用、修改及部署。用 Docker Compose 在自己的電腦或伺服器啟動，資料由你管理；企業可連接既有 OIDC 身分服務，或透過選用的 Keycloak 整合 SAML／LDAP。

這個網站是介紹及操作文件，平台需自行部署。現階段為 **v0.1.0 早期公開版**；Knowledge 提供文字搜尋，Code 需要 Gitea 才能變更 repository，尚未提供內建 CI、SCIM 或分散式執行。選用外部模型可能產生供應商費用；DEMO 不呼叫付費模型。

[自行部署 →](./containers.md) · [功能與限制](./roadmap.md) · [GitHub 原始碼](https://github.com/ordivant-ai/ordivant)
