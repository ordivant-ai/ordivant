# Ordivant Work

Work 用来整理项目、任务、Agent 运行、消息、成果证据与独立审核。Task 是业务工作；Run/Execution 是一次实际运行。运行完成不会自动把 Task 标成完成，必须由有权限且非提交者的审核者接受成果。

![Work 任务清单：以任务状态追踪示范项目](/screenshots/work-zh-CN.png)

<span id="建立專案與任務"></span>
<span id="创建项目与任务"></span>

## 创建项目与任务 {#create-projects-and-tasks}

1. 由 Identity 管理员在 Work 创建 Project，并把成员授权到这个 Project。成员只会看到自己获授权的范围。
2. 在 Project 的「任务」创建 Task，填写目标、描述、输入数据、运行范围、限制、验收条件和优先级。
3. 选择具备所需能力、且已获授权此 Project 的运行 Agent；指定另一个 reviewer。需要先完成的 Task 可加为 dependency。系统拒绝循环依赖；前置任务要完成独立审核后，后续任务才可开始。
4. 保存后在任务清单搜索或依状态查看工作。修改任务规格不会取代已保存的运行与审核历程。

<span id="執行並提交證據"></span>
<span id="运行并提交证据"></span>

## 运行并提交证据 {#execute-and-submit-evidence}

Agent 领取任务后，每次执行都会留下独立记录。自动执行需要管理员先启用 Agent 执行服务；尚未启用时，仍可手动安排任务、提交成果与进行审核。派发操作详见[Run 与自动化](../execution-usage.md)。

运行者完成工作后，提交摘要及一项或多项成果，例如文字、Artifact URI 或文件／测试结果引用。提交会把 Task 移入待审核，并保留本次 Run 的事件与收据。请在成果中说明如何对照验收条件；「Run done」只代表运行已提交，不等于 Task 已被接受。

Reviewer 在 Task 详情检查摘要与证据，选择接受或退回并附上说明。接受会完成 Task；退回会把它送回可运行状态并保留先前证据。提交者不能自行接受自己的成果。任务被拒绝或重试时，新的运行纪录不会覆写旧历程。

<span id="協作與引用"></span>
<span id="协作与引用"></span>

## 协作与引用 {#collaboration-and-citations}

在 Task 脉络使用消息向其他成员或 Agent 提问、回复、交接工作或记录决议。具备 Project 管理权或为父任务负责人的 Agent 可委派子任务；委派不会自动授予受托人其他 Project 的访问权。

若工作依赖 Knowledge 文档，将该文档的**特定版本引用 URI** 放入 Task 输入或提交证据，并保留版本号。引用只是来源纪录，不会替读者授权 Knowledge Space；需要阅读原文的成员必须另外获授权。Knowledge 引用格式与操作见[Knowledge 指南](knowledge.md)。

Work 也能读取已设置的既有 GitHub、GitLab 或 Gitea PR/check 状态。这是项目范围内的读取与证据查看；它不会合并 PR，也不会代替独立审核。Code 中由 Gitea 管理的 repository 与 PR 操作见[Code 指南](code.md)。

<span id="run-控制"></span>

## Run 控制 {#run-controls}

在「Run 执行」查看每次执行的状态、事件与用量。管理员或项目管理者可暂停、继续、停止或重试。暂停会在下一个工具操作前生效，并保留任务；停止后，本次执行不能再更新任务。重试会创建新的 Run。已完成的外部操作不会因停止而撤销，重试前请先核对结果。

控制台的 Run 状态、等待与停止语意、沙箱和工具设置详见[运行使用指南](../execution-usage.md)。工具外部副作用不会因重试而自动重播；不确定的操作结果应先到上游服务核对。

<span id="權限概覽"></span>
<span id="权限概览"></span>

## 权限概览 {#permissions-overview}

- **Manager**：管理已授权 Project 的任务与运行安排。
- **Worker**：运行被授权的工作并提交成果。
- **Reviewer**：审查提交的成果；不能批准自己的提交。

组织管理员负责创建 Project、邀请成员及分配产品角色。Work 访问以 Project scope 与 manager、worker、reviewer 身分为准；没有独立的 Work Reader role。人类登录工作阶段不会变成 Agent/runtime 凭证。
