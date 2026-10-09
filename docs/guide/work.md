# Ordivant Work

Work 用來整理專案、任務、Agent 執行、訊息、成果證據與獨立審核。Task 是業務工作；Run/Execution 是一次實際執行。執行完成不會自動把 Task 標成完成，必須由有權限且非提交者的審核者接受成果。

![Work 任務清單：以任務狀態追蹤示範專案](/screenshots/work-zh-TW.png)

<span id="建立專案與任務"></span>
<span id="创建项目与任务"></span>

## 建立專案與任務 {#create-projects-and-tasks}

1. 由 Identity 管理員在 Work 建立 Project，並把成員授權到這個 Project。成員只會看到自己獲授權的範圍。
2. 在 Project 的「任務」建立 Task，填寫目標、描述、輸入資料、執行範圍、限制、驗收條件和優先順序。
3. 選擇具備所需能力、且已獲授權此 Project 的執行 Agent；指定另一個 reviewer。需要先完成的 Task 可加為 dependency。系統拒絕循環依賴；前置任務要完成獨立審核後，後續任務才可開始。
4. 儲存後在任務清單搜尋或依狀態查看工作。修改任務規格不會取代已保存的執行與審核歷程。

<span id="執行並提交證據"></span>
<span id="运行并提交证据"></span>

## 執行並提交證據 {#execute-and-submit-evidence}

Agent 領取任務後，每次執行都會留下獨立紀錄。自動執行需要管理員先啟用 Agent 執行服務；尚未啟用時，仍可手動安排任務、提交成果與進行審核。派發操作詳見[Run 與自動化](../execution-usage.md)。

執行者完成工作後，提交摘要及一項或多項成果，例如文字、Artifact URI 或檔案／測試結果引用。提交會把 Task 移入待審核，並保留本次 Run 的事件與收據。請在成果中說明如何對照驗收條件；「Run done」只代表執行已提交，不等於 Task 已被接受。

Reviewer 在 Task 詳情檢查摘要與證據，選擇接受或退回並附上說明。接受會完成 Task；退回會把它送回可執行狀態並保留先前證據。提交者不能自行接受自己的成果。任務被拒絕或重試時，新的執行紀錄不會覆寫舊歷程。

<span id="協作與引用"></span>
<span id="协作与引用"></span>

## 協作與引用 {#collaboration-and-citations}

在 Task 脈絡使用訊息向其他成員或 Agent 提問、回覆、交接工作或記錄決議。具備 Project 管理權或為父任務負責人的 Agent 可委派子任務；委派不會自動授予受託人其他 Project 的存取權。

若工作依賴 Knowledge 文件，將該文件的**特定版本引用 URI** 放入 Task 輸入或提交證據，並保留版本號。引用只是來源紀錄，不會替讀者授權 Knowledge Space；需要閱讀原文的成員必須另外獲授權。Knowledge 引用格式與操作見[Knowledge 指南](knowledge.md)。

Work 也能讀取已設定的既有 GitHub、GitLab 或 Gitea PR/check 狀態。這是專案範圍內的讀取與證據檢視；它不會合併 PR，也不會代替獨立審核。Code 中由 Gitea 管理的 repository 與 PR 操作見[Code 指南](code.md)。

<span id="run-控制"></span>

## Run 控制 {#run-controls}

在「Run 執行」查看每次執行的狀態、事件與用量。管理員或專案管理者可暫停、繼續、停止或重試。暫停會在下一個工具操作前生效，並保留任務；停止後，本次執行不能再更新任務。重試會建立新的 Run。已完成的外部操作不會因停止而撤銷，重試前請先核對結果。

控制台的 Run 狀態、等待與停止語意、沙箱和工具設定詳見[執行使用指南](../execution-usage.md)。工具外部副作用不會因重試而自動重播；不確定的操作結果應先到上游服務核對。

<span id="權限概覽"></span>
<span id="权限概览"></span>

## 權限概覽 {#permissions-overview}

- **Manager**：管理已授權 Project 的任務與執行安排。
- **Worker**：執行被授權的工作並提交成果。
- **Reviewer**：審查提交的成果；不能批准自己的提交。

組織管理員負責建立 Project、邀請成員及分配產品角色。Work 存取以 Project scope 與 manager、worker、reviewer 身分為準；沒有獨立的 Work Reader role。人類登入工作階段不會變成 Agent/runtime 憑證。
