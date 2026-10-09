<span id="開始使用-ordivant"></span>
<span id="开始使用-ordivant"></span>

# 开始使用 Ordivant {#getting-started-with-ordivant}

以“整理产品上线清单”为例，带你从登录、创建任务到审查成果。使用团队提供的 Ordivant 网址；若是自己部署，请先完成安装，再打开你的平台网址。

<span id="準備環境"></span>
<span id="准备环境"></span>
<span id="prepare-the-environment"></span>

## 登录与界面语言 {#sign-in-and-language}

若是全新安装，请依首次画面创建初始管理员并保存复原码；之后使用自己的账号登录。若加入现有团队，在登录页选择「接受邀请」，输入邀请码并设置自己的密码。如果组织使用单点登录，请选择登录页显示的组织身份服务。Ordivant 没有默认人员账号或密码；如果没有邀请或无法登录，请联系管理员。其他登录方式见[账号与登录](../human-login.md)。

登录后可使用「界面语言」选择「繁體中文」、「简体中文」或「English」。切换语言会更改平台界面文字，不会自动翻译成员创建的任务、文档或留言。

![登录页：受邀成员可登录或接受邀请](/screenshots/login-zh-CN.png)

## 选择工作区与项目 {#choose-workspace-and-project}

在产品导航中选择 **Work**，再从「选择项目」列表打开管理员授予你访问权限的项目。我们将用整理产品上线清单作为任务示例。若你是初始管理员，按「创建项目」，填入项目代码与名称；例如 LAUNCH、产品上线准备。一般成员若没有可选项目，请联系管理员授予访问权限。登录平台不会自动获得所有项目的访问权限。

<span id="複製並啟動"></span>
<span id="拷贝并启动"></span>
<span id="clone-and-start"></span>
<span id="create-task-and-review"></span>

## 创建第一个任务 {#create-first-task}

在任务页选择「新增任务」，将「整理产品上线清单」填入任务名称。目标可写为“整理产品正式上线前需要完成的准备事项”，再按需补充输入资料、工作范围和限制条件。

在「验收条件」中逐行写下可核对的标准，例如“列出所有上线前准备事项”、“每项标明负责人和当前状态”、“附上可追溯的来源或证据”。填写后选择「创建任务」保存。暂时没有合适的 Agent 时，可以先不指派，下一步再选择。字段说明见[Work 任务与审核指南](work.md)。

<span id="seed-與-runtime"></span>
<span id="seed-与-runtime"></span>
<span id="seed-and-runtime"></span>
<span id="create-project-and-agent"></span>

![任务详细资料：查看目标与验收条件，选择 Pi Agent 派发](/screenshots/task-zh-CN.png)

## 选择 Agent 并开始运行 {#select-agent-and-run}

若要自动运行，由管理员或项目管理者在任务详情的「选择 Pi 执行 Agent」选择可用 Agent，再按「派发给 Agent」。这会创建 Run；打开侧栏的「Run 运行」即可查看进度、事件与成果。若要手动接手工作，使用「选择执行 Agent」与「认领任务」；认领不会启动自动运行。如果没有合适的 Agent，管理员或有 Agent 管理权限的成员可以在 Agent 页面选择「新增 Agent」，设置「执行者」角色和能力，自动运行时将「Runtime」选为「Pi Durable」，并确认该 Agent 已获准访问当前项目。若你没有管理权限，请联系管理员或项目管理者。

是否自动执行取决于管理员设置。若要自动执行，管理员必须启用 Agent 执行服务并设置有效模型连接；尚未设置时，仍可手动安排工作、提交成果并审核。Run 若标记为 **DEMO**，表示它不是付费模型调用。管理员可参阅[运行与自动化指南](../execution-usage.md)了解执行设置。

<span id="檢查與停止"></span>
<span id="检查与停止"></span>
<span id="check-and-stop"></span>

![Run 控制台：查看 DEMO 运行的事件与提交结果](/screenshots/run-zh-CN.png)

## 提交成果并完成审核 {#submit-and-review}

以上线清单为例，执行者完成整理后提交摘要以及清单、来源链接等证据。任务会进入待审核状态；另一位 Reviewer 对照验收条件检查证据后，可以接受成果或退回修改。执行者不能接受自己的提交。Run 显示完成不代表任务已完成，只有经过独立审核并接受后，任务才会标记为完成。详细操作见[Work 任务与审核指南](work.md)。

<span id="self-host"></span>

## 功能简介 {#product-overview}

- **Work**：管理项目与任务、安排 Agent 执行工作，并通过成果证据和独立审核追踪完成状态。
- **Knowledge**：整理带版本的文档、决策和来源引用，供成员在工作中查找和引用。
- **Code**：查看代码仓库、提交记录、Pull Request 和检查状态。

<span id="接下來"></span>
<span id="接下来"></span>

## 后续步骤 {#next-steps}

- [Work：任务与审核](work.md)
- [Knowledge：文档、版本与引用](knowledge.md)
- [Code：仓库与 Pull Request](code.md)
- [管理员、角色与 SSO](administration.md)
- [账号与登录](../human-login.md)
