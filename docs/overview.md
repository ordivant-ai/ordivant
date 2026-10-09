<span id="專案介紹"></span>
<span id="项目介绍"></span>

# 專案介紹 {#project-overview}

Ordivant 是可自行部署的團隊協作平台，讓人員與 Agent 在明確的專案範圍內一起完成工作。Work 用來規劃任務和檢查執行成果；Knowledge 保存可追溯的文件版本與決策；Code 在設定 Gitea 後管理程式碼分支與 Pull Request。先看[功能導覽](./features.md)，再從[建立第一個專案](./guide/first-project.md)和[團隊設定](./guide/team-setup.md)開始。

<span id="使用者與團隊"></span>

## 使用者與團隊 {#roles-and-teams}

Ordivant 適合需要追蹤交付物、明確交接工作，或讓 Agent 參與有審查流程工作的產品、工程、研究與營運團隊。管理者先授予人員和 Agent 可使用的產品及資源範圍；同一個人可以在不同產品有不同角色。

| 使用者 | 在 Ordivant 中負責的工作 |
| --- | --- |
| 組織管理員 | 邀請成員、設定登入方式，並授予 Work 專案、Knowledge Space、Code 專案的權限範圍。 |
| Work 管理者 | 在已授權的專案建立與指派任務，管理流程及執行安排。 |
| Agent | 執行已獲授權的工作，回報進度並提交成果；範本不會替 Agent 增加專案權限。 |
| Work 審查者 | 檢查任務成果與證據。提交者不能審查自己的成果。 |
| Knowledge 編輯者／讀者 | 編輯者發佈文件新版本和決策；讀者搜尋並閱讀已授權 Space 的內容。 |
| Code 寫入者／讀者 | 寫入者管理已授權專案的 repository 變更與 PR；讀者查看內容和狀態。 |

<span id="典型工作日"></span>

## 典型工作日 {#typical-workday}

1. 工作負責人在 Work 專案中建立任務，寫清楚目標、輸入、範圍、限制與驗收條件，並把必須先完成的工作設為相依任務。
2. Agent 執行獲指派的工作；遇到問題時可在任務脈絡請求協作，或把可拆分的交付物委派成子任務。管理者可從 Run 頁查看執行狀態。
3. 執行者提交成果後，由另一位具備權限的人員檢查證據並接受或退回。退回時，先前執行和證據仍可查閱。
4. 團隊把穩定規格、決策和來源存入 Knowledge，後續任務引用精確文件版本。若工作涉及程式碼，則在 Code 建立分支、提交和 PR，再依組織的 Gitea 流程審查。

這些產品會保留各自的權限範圍；附上另一個產品的引用不會自動授予讀取權。

<span id="四個服務邊界"></span>
<span id="四个服务边界"></span>

## 選擇產品 {#four-service-boundaries}

| 產品 | 何時使用 | 主要結果 |
| --- | --- | --- |
| Work | 需要分派多人或 Agent 工作、追蹤相依性、協作、執行與獨立審查時。 | 任務、執行紀錄、提交證據和審查結果。 |
| Knowledge | 需要維護可追溯的規格、決策、歷史版本或來源引用時。 | 不可變文件版本、決策紀錄和精確版本引用；搜尋目前是文字搜尋。 |
| Code（選用） | 團隊要在 Ordivant 中管理 Gitea repository、分支、commit 與 PR 時。 | 程式碼變更、PR、來源引用和狀態收據。Code 需要部署端設定 Gitea。 |

三個產品使用共用的 Identity 登入，但有各自的角色與資源授權，可分開部署。Work 不依賴 Code；若團隊使用 GitHub、GitLab 或 Gitea，也可在 Work 設定後讀取外部 PR 與檢查狀態。這項 Work 整合是唯讀檢視，不會替你合併 PR。詳細功能和入口見[功能導覽](./features.md)。

<span id="快速開始與操作指南"></span>

## 快速開始與操作指南 {#start-here}

- [建立第一個專案](./guide/first-project.md)：從建立專案到建立第一項任務。
- [設定團隊](./guide/team-setup.md)：邀請成員並安排產品角色與資源範圍。
- [Work 任務與審查](./guide/work.md)、[Knowledge 文件](./guide/knowledge.md)、[Code PR](./guide/code.md)。
- [模型連線](./model-usage.md)、[Run、自動流程、工具與沙箱](./execution-usage.md)、[管理員與企業登入](./guide/administration.md)。

<span id="完成與證據"></span>
<span id="完成与证据"></span>

## 任務如何完成 {#completion-and-evidence}

Agent 執行結束不代表任務已完成。執行者需提交成果與相關證據，再由另一位獲授權的審查者檢查並接受；執行者不能自行審查自己的成果。DEMO 模式用於示範，不會呼叫付費模型，因此不能當成真實模型結果或實際費用。實際費用若無法確認，平台會標示為未知。

<span id="適用與限制"></span>
<span id="适用与限制"></span>

## 適用範圍與目前限制 {#intended-use-and-limits}

Ordivant 適合希望自行管理服務與資料，並逐步導入 Agent 協作的團隊。各產品可獨立部署，但登入、模型、外部工具及版控服務仍須依實際環境設定。Run 的模型用量不一定包含可核對的美元費用；模型供應商負責實際計費。外部 MCP 工具可能會修改上游資料；沙箱工作區是暫存空間，並不提供 VM 等級隔離。請在[功能導覽](./features.md)及各操作指南確認細節。

Work 目前由單一執行服務處理工作，尚未提供多台服務共同分散執行；高負載能力與各組織的登入、程式碼平台和模型設定，都需依實際環境確認。更多功能狀態見[路線圖](./roadmap.md)，版本與升級資訊見[版本說明](./release.md)。
